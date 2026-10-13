use std::fmt;
use std::ops::Add;
use std::str::FromStr;

use serde::de::{self, Visitor};
use serde::{Deserialize, Serialize};

#[derive(Default, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Duration {
    pub seconds: u32,
}

impl std::fmt::Display for Duration {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if self.seconds == 0 {
            f.write_str("0s")?;
            return Ok(());
        }

        let units = [("d", 86400), ("h", 3600), ("m", 60), ("s", 1)];
        let mut secs = self.seconds;
        let mut pending_space = false;
        for (name, size) in units {
            let val = secs / size;
            secs %= size;
            if val > 0 {
                if pending_space {
                    f.write_str(" ")?;
                }
                std::fmt::Display::fmt(&val, f)?;
                f.write_str(name)?;
                pending_space = true;
            }
        }
        Ok(())
    }
}

impl FromStr for Duration {
    type Err = &'static str;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        const OVERFLOW: &str = "invalid duration, overflow";
        let mut seconds: u32 = 0;
        let mut it = s
            .as_bytes()
            .trim_ascii()
            .chunk_by(|a, b| a.is_ascii_digit() == b.is_ascii_digit());
        let mut did_loop = false;
        loop {
            let digits = match it.next() {
                // chunks are non empty and either all digits or all non digits
                Some(digits) if digits[0].is_ascii_digit() => Some(
                    digits
                        .iter()
                        .try_fold(0u32, |acc, &digit| {
                            acc.checked_mul(10)?.checked_add(u32::from(digit - b'0'))
                        })
                        .ok_or(OVERFLOW)?,
                ),
                _ => None,
            };
            let unit = it.next().map(|unit| unit.trim_ascii());
            let (digits, unit_seconds) = match (digits, unit) {
                (Some(digits), Some(b"d")) => (digits, 86400),
                (Some(digits), Some(b"h")) => (digits, 3600),
                (Some(digits), Some(b"m")) => (digits, 60),
                (Some(digits), Some(b"s")) => (digits, 1),
                (Some(_), _) => return Err("invalid duration, 'd', 'h', 'm' or 's' expected"),
                (None, Some(_)) => return Err("invalid duration, <digits> expected"),
                (None, None) if !did_loop => return Err("invalid duration, <digits> expected"),
                (None, None) => return Ok(Duration { seconds }),
            };
            seconds = digits
                .checked_mul(unit_seconds)
                .and_then(|s| seconds.checked_add(s))
                .ok_or(OVERFLOW)?;
            did_loop = true;
        }
    }
}

impl std::fmt::Debug for Duration {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Display::fmt(self, f)?;
        write!(f, " ({} seconds)", self.seconds)
    }
}

struct DurationVisitor;

impl<'de> Visitor<'de> for DurationVisitor {
    type Value = Duration;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("a duration (eg. 10h 30m)")
    }

    fn visit_str<E>(self, v: &str) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        Duration::from_str(v).map_err(|err| serde::de::Error::custom(err))
    }
}

impl<'de> Deserialize<'de> for Duration {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        deserializer.deserialize_str(DurationVisitor)
    }
}
impl Serialize for Duration {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Default, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Size {
    pub bytes: usize,
}

const KB: usize = 1024;
const MB: usize = 1024 * KB;
const GB: usize = 1024 * MB;

impl Add for Size {
    type Output = Size;

    fn add(self, rhs: Self) -> Self::Output {
        Size {
            bytes: self.bytes + rhs.bytes,
        }
    }
}

impl std::fmt::Display for Size {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if self.bytes == 0 {
            f.write_str("0B")?;
            return Ok(());
        }
        let bytes = self.bytes as f64;
        let (digits, unit) = match self.bytes {
            GB.. => (bytes / (GB as f64), "GB"),
            MB..GB => (bytes / (MB as f64), "MB"),
            KB..MB => (bytes / (KB as f64), "KB"),
            ..KB => (bytes, "B"),
        };
        if digits.fract() == 0.0 {
            write!(f, "{digits:.0}{unit}")
        } else {
            let precision = f.precision().unwrap_or(1);
            write!(f, "{digits:.precision$}{unit}")
        }
    }
}

impl FromStr for Size {
    type Err = &'static str;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let s = s.trim_ascii();
        let digits_len = s
            .chars()
            .take_while(|&c| c.is_ascii_digit() || c == '.')
            .count();
        let (digits, unit) = s.split_at(digits_len);
        let unit = unit.trim_ascii();
        let digits =
            f64::from_str(digits).map_err(|_| "invalid size, <digits>[.<digits>] expected")?;
        let mult = match unit {
            "GB" => GB as f64,
            "MB" => MB as f64,
            "KB" => KB as f64,
            "B" => 1f64,
            _ => return Err("invalid size, 'GB', 'KB', 'MB' or 'B' expected"),
        };
        let digits = digits * mult;
        const MAX: f64 = usize::MAX as f64;
        let bytes = match digits {
            0f64..=MAX => digits as usize,
            _ => return Err("invalid size, overflow"),
        };
        Ok(Size { bytes })
    }
}

impl std::fmt::Debug for Size {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Display::fmt(self, f)?;
        write!(f, " ({} bytes)", self.bytes)
    }
}

struct SizeVisitor;

impl<'de> Visitor<'de> for SizeVisitor {
    type Value = Size;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("a size (eg. 1.5GB)")
    }

    fn visit_str<E>(self, v: &str) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        Size::from_str(v).map_err(|err| serde::de::Error::custom(err))
    }
}

impl<'de> Deserialize<'de> for Size {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        deserializer.deserialize_str(SizeVisitor)
    }
}
impl Serialize for Size {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_duration() {
        fn test_parse(src: &str, display: &str, seconds: u32) {
            let parsed = Duration::from_str(src);
            assert_eq!(parsed, Ok(Duration { seconds }));
            assert_eq!(parsed.unwrap().to_string().as_str(), display);
        }
        test_parse("0s", "0s", 0);
        test_parse("60s", "1m", 60);
        test_parse("1m30s", "1m 30s", 90);
        test_parse("1m 30s", "1m 30s", 90);
        test_parse(" 1m 30s  ", "1m 30s", 90);
        test_parse(" 30s 1m  ", "1m 30s", 90);
        test_parse("1d3600s", "1d 1h", 90000);
        test_parse("10d 7h 6m20s", "10d 7h 6m 20s", 889580);
        assert_eq!(
            Duration::from_str(""),
            Err("invalid duration, <digits> expected")
        );
        assert_eq!(
            Duration::from_str("1..0d"),
            Err("invalid duration, 'd', 'h', 'm' or 's' expected")
        );
        assert_eq!(
            Duration::from_str("1"),
            Err("invalid duration, 'd', 'h', 'm' or 's' expected")
        );
        assert_eq!(
            Duration::from_str("1dm"),
            Err("invalid duration, 'd', 'h', 'm' or 's' expected")
        );
        test_parse("4294967295s", "49710d 6h 28m 15s", u32::MAX);
        assert_eq!(
            Duration::from_str("4294967296s"),
            Err("invalid duration, overflow")
        );
        assert_eq!(
            Duration::from_str("50000d"),
            Err("invalid duration, overflow")
        );
        assert_eq!(
            Duration::from_str("4294967295s 1s"),
            Err("invalid duration, overflow")
        );
    }

    #[test]
    fn parse_size() {
        fn test_parse(src: &str, display: &str, bytes: usize) {
            let parsed = Size::from_str(src);
            assert_eq!(parsed, Ok(Size { bytes }));
            assert_eq!(parsed.unwrap().to_string().as_str(), display);
        }
        test_parse("0B", "0B", 0);
        test_parse("60B", "60B", 60);
        test_parse("256.0 KB", "256KB", 256 * KB);
        test_parse("1.5MB", "1.5MB", 1 * MB + 512 * KB);
        test_parse("1.5GB", "1.5GB", 1 * GB + 512 * MB);
        test_parse("64GB", "64GB", 64 * GB);
        assert_eq!(
            Size::from_str(""),
            Err("invalid size, <digits>[.<digits>] expected")
        );
        assert_eq!(
            Size::from_str("1..0B"),
            Err("invalid size, <digits>[.<digits>] expected")
        );
        assert_eq!(
            Size::from_str("1"),
            Err("invalid size, 'GB', 'KB', 'MB' or 'B' expected")
        );
        assert_eq!(
            Size::from_str("1LB"),
            Err("invalid size, 'GB', 'KB', 'MB' or 'B' expected")
        );
    }
}
