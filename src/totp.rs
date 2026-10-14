//! TOTP codes (RFC 6238) required to create big notes: HMAC-SHA256, 6 digits, a new code every 30 seconds.
//! Some authenticator apps ignore the algorithm and always use SHA1, their codes are refused.

use std::fmt;
use std::net::{IpAddr, Ipv4Addr};
use std::time::{Duration, Instant};

use hmac::{Hmac, Mac};
use rand::Rng;
use serde::{Deserialize, Serialize, de};
use sha2::Sha256;

use crate::ratelimit::RateLimiter;

const STEP_SECS: u64 = 30;
const DIGITS: usize = 6;
/// Codes of the previous and next steps are also accepted, for clock drift and typing time
const DRIFT_STEPS: u64 = 1;
/// RFC 4226 requires at least 128 bits
const MIN_SECRET_LEN: usize = 16;
/// The HMAC-SHA256 output length, as RFC 6238 test secrets
const GENERATED_SECRET_LEN: usize = 32;

/// Default invalid codes allowed per client over `DEFAULT_FAILURES_PERIOD`
pub const DEFAULT_MAX_CLIENT_FAILURES: u32 = 5;
/// Default invalid codes allowed from all clients over `DEFAULT_FAILURES_PERIOD`, against guesses from
/// many addresses: about 175 000 guesses a year, each with a 3 in a million chance, so about one success
/// every two years. Repeated invalid codes also block big notes for everyone until the budget refills.
pub const DEFAULT_MAX_FAILURES: u32 = 20;
pub const DEFAULT_FAILURES_PERIOD: Duration = Duration::from_secs(3600);
/// `max_failures` budget key, shared by all clients
const ALL_CLIENTS: IpAddr = IpAddr::V4(Ipv4Addr::UNSPECIFIED);

const BASE32: base32::Alphabet = base32::Alphabet::Rfc4648 { padding: false };

fn base32_encode(bytes: &[u8]) -> String {
    base32::encode(BASE32, bytes)
}

/// Case insensitive, ignoring spaces (as secrets are often shown in groups) and padding
fn base32_decode(s: &str) -> Option<Vec<u8>> {
    let mut s: String = s.trim_end_matches('=').chars().filter(|c| *c != ' ').collect();
    s.make_ascii_uppercase();
    base32::decode(BASE32, &s)
}

/// TOTP shared secret, never printed
#[derive(Clone)]
pub struct TotpSecret(Vec<u8>);

impl TotpSecret {
    pub fn generate() -> Self {
        let secret: [u8; GENERATED_SECRET_LEN] = rand::rng().random();
        Self(secret.to_vec())
    }

    pub fn base32(&self) -> String {
        base32_encode(&self.0)
    }

    /// Link added to authenticator apps, also as a QR code
    pub fn otpauth_uri(&self) -> String {
        format!("otpauth://totp/rsecnotes?secret={}&issuer=rsecnotes&algorithm=SHA256", self.base32())
    }
}

impl fmt::Debug for TotpSecret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("<redacted>")
    }
}

impl std::str::FromStr for TotpSecret {
    type Err = &'static str;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let secret = base32_decode(s).ok_or("invalid totp secret, base32 expected")?;
        if secret.len() < MIN_SECRET_LEN {
            return Err("invalid totp secret, at least 128 bits expected (26 base32 characters)");
        }
        Ok(Self(secret))
    }
}

impl<'de> Deserialize<'de> for TotpSecret {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        String::deserialize(deserializer)?.parse().map_err(de::Error::custom)
    }
}

impl Serialize for TotpSecret {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.base32())
    }
}

/// RFC 4226 code of `counter`, with HMAC-SHA256 (RFC 6238)
fn hotp(secret: &[u8], counter: u64) -> u32 {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret).expect("HMAC accepts keys of any length");
    mac.update(&counter.to_be_bytes());
    let hash = mac.finalize().into_bytes();
    let offset = usize::from(hash[hash.len() - 1] & 0xf);
    let bin = u32::from_be_bytes(hash[offset..offset + 4].try_into().unwrap()) & 0x7fff_ffff;
    bin % 10u32.pow(DIGITS as u32)
}

#[derive(Debug, PartialEq, Eq)]
pub enum Rejected {
    Missing,
    /// Wrong, malformed or expired
    Invalid,
    /// Too many invalid codes, retry after this duration
    TooManyFailures(Duration),
}

/// A code can be used several times while it is valid (unlike RFC 6238 5.2), the notes creation
/// rate limit bounds what a seen code allows
pub struct Totp {
    secret: TotpSecret,
    client_failures: RateLimiter,
    failures: RateLimiter,
}

impl Totp {
    /// Invalid codes are limited to `max_client_failures` per client and `max_failures` in total over
    /// `failures_period`, all non zero
    pub fn new(secret: TotpSecret, max_client_failures: u32, max_failures: u32, failures_period: Duration) -> Self {
        Self {
            secret,
            client_failures: RateLimiter::new(max_client_failures, 1, failures_period),
            failures: RateLimiter::new(max_failures, 1, failures_period),
        }
    }

    /// Accept `code` from `ip` at `unix_secs`, invalid codes consume the failures budgets
    pub fn verify(&mut self, ip: IpAddr, code: Option<&str>, unix_secs: u64, now: Instant) -> Result<(), Rejected> {
        let code = code.ok_or(Rejected::Missing)?;
        let wait = [
            self.client_failures.check(ip, 0, now),
            self.failures.check(ALL_CLIENTS, 0, now),
        ]
        .into_iter()
        .filter_map(Result::err)
        .max();
        if let Some(wait) = wait {
            return Err(Rejected::TooManyFailures(wait));
        }
        if self.accept(code, unix_secs) {
            Ok(())
        } else {
            // Both were checked above
            let _ = self.client_failures.try_acquire(ip, 0, now);
            let _ = self.failures.try_acquire(ALL_CLIENTS, 0, now);
            Err(Rejected::Invalid)
        }
    }

    fn accept(&self, code: &str, unix_secs: u64) -> bool {
        if code.len() != DIGITS || !code.bytes().all(|c| c.is_ascii_digit()) {
            return false;
        }
        let Ok(code) = code.parse::<u32>() else { return false };
        let current = unix_secs / STEP_SECS;
        // Every step is computed, the time taken does not tell which one matched
        let mut matched = false;
        for step in current.saturating_sub(DRIFT_STEPS)..=current + DRIFT_STEPS {
            matched |= hotp(&self.secret.0, step) == code;
        }
        matched
    }

    /// Forget clients whose failures budget is fully refilled
    pub fn collect_full_buckets(&mut self, now: Instant) {
        self.client_failures.collect_full_buckets(now);
        self.failures.collect_full_buckets(now);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// RFC 6238 appendix B SHA256 secret
    fn rfc_secret() -> TotpSecret {
        TotpSecret(b"12345678901234567890123456789012".to_vec())
    }

    const MAX_CLIENT_FAILURES: u32 = 3;
    const MAX_FAILURES: u32 = 8;
    const FAILURES_PERIOD: Duration = Duration::from_secs(600);

    fn new_totp() -> Totp {
        Totp::new(rfc_secret(), MAX_CLIENT_FAILURES, MAX_FAILURES, FAILURES_PERIOD)
    }

    fn code(secret: &TotpSecret, unix_secs: u64) -> String {
        format!("{:06}", hotp(&secret.0, unix_secs / STEP_SECS))
    }

    #[test]
    fn rfc6238_vectors() {
        // Appendix B 8 digits codes, the last 6 digits
        let secret = rfc_secret();
        assert_eq!(code(&secret, 59), "119246");
        assert_eq!(code(&secret, 1111111109), "084774");
        assert_eq!(code(&secret, 1111111111), "062674");
        assert_eq!(code(&secret, 1234567890), "819424");
        assert_eq!(code(&secret, 2000000000), "698825");
        assert_eq!(code(&secret, 20000000000), "737706");
    }

    #[test]
    fn base32() {
        assert_eq!(base32_encode(b"Hello!\xDE\xAD\xBE\xEF"), "JBSWY3DPEHPK3PXP");
        assert_eq!(base32_decode("JBSWY3DPEHPK3PXP").unwrap(), b"Hello!\xDE\xAD\xBE\xEF");
        assert_eq!(base32_decode("jbsw y3dp ehpk 3pxp").unwrap(), b"Hello!\xDE\xAD\xBE\xEF");
        assert_eq!(base32_decode("MZXW6===").unwrap(), b"foo");
        assert_eq!(base32_decode("MZXW1"), None);
        let secret = TotpSecret::generate();
        assert_eq!(base32_decode(&secret.base32()).unwrap(), secret.0);
    }

    #[test]
    fn secret_parsing() {
        assert!("JBSWY3DPEHPK3PXP".parse::<TotpSecret>().is_err());
        assert!("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP".parse::<TotpSecret>().is_ok());
        assert!("not base32!".parse::<TotpSecret>().is_err());
        assert_eq!(format!("{:?}", rfc_secret()), "<redacted>");
    }

    #[test]
    fn drift_and_reuse() {
        let ip: IpAddr = "1.2.3.4".parse().unwrap();
        let now = Instant::now();
        let t = 1_000_000_020;
        let mut totp = new_totp();
        // The previous, current and next steps are accepted, even several times
        for _ in 0..2 {
            for step in [t - 30, t, t + 30] {
                assert_eq!(totp.verify(ip, Some(&code(&totp.secret, step)), t, now), Ok(()));
            }
        }
        // Too old or too early
        assert_eq!(totp.verify(ip, Some(&code(&totp.secret, t - 60)), t, now), Err(Rejected::Invalid));
        assert_eq!(totp.verify(ip, Some(&code(&totp.secret, t + 60)), t, now), Err(Rejected::Invalid));
    }

    #[test]
    fn malformed() {
        let ip: IpAddr = "1.2.3.4".parse().unwrap();
        let now = Instant::now();
        let t = 1_000_000_020;
        let valid = code(&rfc_secret(), t);
        let mut totp = new_totp();
        assert_eq!(totp.verify(ip, None, t, now), Err(Rejected::Missing));
        let codes = ["", "12345", "1234567", "+12345", " 12345", "١٢٣٤٥٦", &format!("{valid} "), &format!("0{valid}")];
        for code in codes {
            let mut totp = new_totp();
            assert_eq!(totp.verify(ip, Some(code), t, now), Err(Rejected::Invalid), "{code:?}");
        }
    }

    #[test]
    fn failures_limits() {
        let ip: IpAddr = "1.2.3.4".parse().unwrap();
        let now = Instant::now();
        let t = 1_000_000_020;
        let mut totp = new_totp();
        let valid = code(&totp.secret, t);
        let wrong = format!("{:06}", (valid.parse::<u32>().unwrap() + 1) % 1_000_000);
        for _ in 0..MAX_CLIENT_FAILURES {
            assert_eq!(totp.verify(ip, Some(&wrong), t, now), Err(Rejected::Invalid));
        }
        // Even a valid code is refused, without consuming it
        let wait = Err(Rejected::TooManyFailures(FAILURES_PERIOD / MAX_CLIENT_FAILURES));
        assert_eq!(totp.verify(ip, Some(&valid), t, now), wait);
        // Other clients share the global budget
        for i in MAX_CLIENT_FAILURES..MAX_FAILURES {
            let other = IpAddr::V4(Ipv4Addr::new(10, 0, 0, i as u8));
            assert_eq!(totp.verify(other, Some(&wrong), t, now), Err(Rejected::Invalid));
        }
        let other: IpAddr = "10.0.1.1".parse().unwrap();
        let wait = Err(Rejected::TooManyFailures(FAILURES_PERIOD / MAX_FAILURES));
        assert_eq!(totp.verify(other, Some(&valid), t, now), wait);
        // Refilled
        let later = now + FAILURES_PERIOD;
        assert_eq!(totp.verify(ip, Some(&valid), t, later), Ok(()));
    }
}
