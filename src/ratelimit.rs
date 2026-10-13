use std::collections::HashMap;
use std::net::{IpAddr, Ipv6Addr};
use std::time::{Duration, Instant};

/// Per client token bucket, refilled continuously over `period`
#[derive(Debug, Clone, Copy)]
struct Bucket {
    notes: f64,
    bytes: f64,
    updated_at: Instant,
}

#[derive(Debug)]
pub struct RateLimiter {
    max_notes: f64,
    max_bytes: f64,
    period: Duration,
    buckets: HashMap<IpAddr, Bucket>,
}

/// Clients are identified by their IPv4 address or by their IPv6 /64 prefix,
/// as a single IPv6 client usually owns a whole /64.
fn client_key(ip: IpAddr) -> IpAddr {
    match ip.to_canonical() {
        IpAddr::V4(ip) => IpAddr::V4(ip),
        IpAddr::V6(ip) => IpAddr::V6(Ipv6Addr::from_bits(ip.to_bits() & !((1u128 << 64) - 1))),
    }
}

impl RateLimiter {
    /// `max_notes` and `period` must be non zero
    pub fn new(max_notes: u32, max_bytes: usize, period: Duration) -> Self {
        assert!(max_notes > 0 && !period.is_zero());
        Self {
            max_notes: max_notes.into(),
            max_bytes: max_bytes as f64,
            period,
            buckets: HashMap::new(),
        }
    }

    fn refill(&self, bucket: &Bucket, now: Instant) -> Bucket {
        let ratio = now
            .saturating_duration_since(bucket.updated_at)
            .as_secs_f64()
            / self.period.as_secs_f64();
        Bucket {
            notes: (bucket.notes + ratio * self.max_notes).min(self.max_notes),
            bytes: (bucket.bytes + ratio * self.max_bytes).min(self.max_bytes),
            updated_at: now,
        }
    }

    /// Consume one note of `bytes` from `ip` budget, or return how long to wait before retrying
    pub fn try_acquire(&mut self, ip: IpAddr, bytes: usize, now: Instant) -> Result<(), Duration> {
        let key = client_key(ip);
        let mut bucket = match self.buckets.get(&key) {
            Some(bucket) => self.refill(bucket, now),
            None => Bucket {
                notes: self.max_notes,
                bytes: self.max_bytes,
                updated_at: now,
            },
        };
        let bytes = bytes as f64;
        if bucket.notes >= 1.0 && bucket.bytes >= bytes {
            bucket.notes -= 1.0;
            bucket.bytes -= bytes;
            self.buckets.insert(key, bucket);
            Ok(())
        } else {
            let missing_notes = (1.0 - bucket.notes).max(0.0) / self.max_notes;
            let missing_bytes = (bytes - bucket.bytes).max(0.0) / self.max_bytes;
            Err(self.period.mul_f64(missing_notes.max(missing_bytes)))
        }
    }

    /// Forget clients whose budget is fully refilled
    pub fn collect_full_buckets(&mut self, now: Instant) {
        let period = self.period;
        self.buckets
            .retain(|_, bucket| now.saturating_duration_since(bucket.updated_at) < period);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOUR: Duration = Duration::from_secs(3600);

    #[test]
    fn notes_limit() {
        let ip: IpAddr = "1.2.3.4".parse().unwrap();
        let now = Instant::now();
        let mut limiter = RateLimiter::new(2, 1000, HOUR);
        assert_eq!(limiter.try_acquire(ip, 0, now), Ok(()));
        assert_eq!(limiter.try_acquire(ip, 0, now), Ok(()));
        assert_eq!(limiter.try_acquire(ip, 0, now), Err(HOUR / 2));
        // other clients are not affected
        assert_eq!(
            limiter.try_acquire("1.2.3.5".parse().unwrap(), 0, now),
            Ok(())
        );
        // half a period refills one note
        assert_eq!(limiter.try_acquire(ip, 0, now + HOUR / 2), Ok(()));
        assert!(limiter.try_acquire(ip, 0, now + HOUR / 2).is_err());
    }

    #[test]
    fn bytes_limit() {
        let ip: IpAddr = "1.2.3.4".parse().unwrap();
        let now = Instant::now();
        let mut limiter = RateLimiter::new(100, 1000, HOUR);
        assert_eq!(limiter.try_acquire(ip, 600, now), Ok(()));
        assert_eq!(limiter.try_acquire(ip, 600, now), Err(HOUR / 5));
        assert_eq!(limiter.try_acquire(ip, 400, now), Ok(()));
        assert_eq!(limiter.try_acquire(ip, 600, now + HOUR * 3 / 5), Ok(()));
    }

    #[test]
    fn ipv6_prefix() {
        let now = Instant::now();
        let mut limiter = RateLimiter::new(1, 1000, HOUR);
        assert_eq!(
            limiter.try_acquire("2001:db8::1".parse().unwrap(), 0, now),
            Ok(())
        );
        assert!(
            limiter
                .try_acquire("2001:db8::2".parse().unwrap(), 0, now)
                .is_err()
        );
        assert_eq!(
            limiter.try_acquire("2001:db8:0:1::1".parse().unwrap(), 0, now),
            Ok(())
        );
        // IPv4 mapped addresses share the IPv4 budget
        assert_eq!(
            limiter.try_acquire("1.2.3.4".parse().unwrap(), 0, now),
            Ok(())
        );
        assert!(
            limiter
                .try_acquire("::ffff:1.2.3.4".parse().unwrap(), 0, now)
                .is_err()
        );
    }

    #[test]
    fn collect() {
        let ip: IpAddr = "1.2.3.4".parse().unwrap();
        let now = Instant::now();
        let mut limiter = RateLimiter::new(2, 1000, HOUR);
        limiter.try_acquire(ip, 0, now).unwrap();
        limiter.collect_full_buckets(now + HOUR / 2);
        assert_eq!(limiter.buckets.len(), 1);
        limiter.collect_full_buckets(now + HOUR);
        assert!(limiter.buckets.is_empty());
    }
}
