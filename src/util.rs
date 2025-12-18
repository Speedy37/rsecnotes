use std::str::FromStr;

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
        let mut seconds = 0;
        let mut it = s
            .as_bytes()
            .trim_ascii()
            .chunk_by(|a, b| a.is_ascii_digit() == b.is_ascii_digit());

        loop {
            let digits = it.next();
            let digits = digits.and_then(|digits| {
                digits
                    .iter()
                    .copied()
                    .take_while(u8::is_ascii_digit)
                    .map(|digit| u32::from(digit - b'0'))
                    .reduce(|acc, digit| acc * 10 + digit)
            });
            let unit = it.next().map(|unit| unit.trim_ascii());
            match (digits, unit) {
                (Some(digits), Some(b"d")) => seconds += digits * 86400,
                (Some(digits), Some(b"h")) => seconds += digits * 3600,
                (Some(digits), Some(b"m")) => seconds += digits * 60,
                (Some(digits), Some(b"s")) => seconds += digits,
                (Some(_), _) => return Err("invalid duration, 'd', 'h', 'm' or 's' expected"),
                (None, Some(_)) => return Err("invalid duration, <digits> expected"),
                (None, None) => return Ok(Duration { seconds }),
            }
        }
    }
}

impl std::fmt::Debug for Duration {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Display::fmt(self, f)?;
        write!(f, "({} seconds)", self.seconds)
    }
}

impl<'de> Deserialize<'de> for Duration {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let str = <&str>::deserialize(deserializer)?;
        Self::from_str(str).map_err(|err| serde::de::Error::custom(err))
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

const GB: usize = 1024 * 1024 * 1024;
const MB: usize = 1024 * 1024;
const KB: usize = 1024;
const B: usize = 1;

impl std::fmt::Display for Size {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if self.bytes == 0 {
            f.write_str("0B")?;
            return Ok(());
        }

        let units = [("GB", GB), ("MB", MB), ("KB", KB), ("B", B)];
        let mut bytes = self.bytes;
        let mut pending_space = false;
        for (name, size) in units {
            let val = bytes / size;
            bytes %= size;
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

impl FromStr for Size {
    type Err = &'static str;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let mut bytes: usize = 0;
        let mut it = s
            .as_bytes()
            .trim_ascii()
            .chunk_by(|a, b| a.is_ascii_digit() == b.is_ascii_digit());
        loop {
            let digits = it.next();
            let digits = digits.and_then(|digits| {
                digits
                    .iter()
                    .copied()
                    .take_while(u8::is_ascii_digit)
                    .map(|digit| usize::from(digit - b'0'))
                    .reduce(|acc, digit| acc * 10 + digit)
            });
            let unit = it.next().map(|unit| unit.trim_ascii());
            match (digits, unit) {
                (Some(digits), Some(b"GB")) => bytes += digits * GB,
                (Some(digits), Some(b"MB")) => bytes += digits * MB,
                (Some(digits), Some(b"KB")) => bytes += digits * KB,
                (Some(digits), Some(b"B")) => bytes += digits,
                (Some(_), _) => return Err("invalid size, 'GB', 'KB', 'MB' or 'B' expected"),
                (None, Some(_)) => return Err("invalid size, <digits> expected"),
                (None, None) => return Ok(Size { bytes }),
            }
        }
    }
}

impl std::fmt::Debug for Size {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Display::fmt(self, f)?;
        write!(f, "({} bytes)", self.bytes)
    }
}

impl<'de> Deserialize<'de> for Size {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let str = <&str>::deserialize(deserializer)?;
        Self::from_str(str).map_err(|err| serde::de::Error::custom(err))
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
        test_parse("1MB30B", "1MB 30B", 1*MB+30*B);
        test_parse("1MB 30B", "1MB 30B", 1*MB+30*B);
        test_parse(" 1MB 30B  ", "1MB 30B", 1*MB+30*B);
        test_parse(" 30GB 1MB  ", "30GB 1MB", 30*GB+1*MB);
        test_parse("1GB3600MB", "4GB 528MB", 1*GB+3600*MB);
        test_parse("10GB 7MB 6KB20B", "10GB 7MB 6KB 20B", 10*GB+7*MB+6*KB+20*B);
    }
}
