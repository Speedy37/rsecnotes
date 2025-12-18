use std::collections::hash_map::Entry;
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::str::FromStr;
use std::time::{Duration, Instant};

use axum::body::Bytes;
use base64::Engine;
use rand::Rng;

use crate::ConfigFileSlot;
use crate::util::Size;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct NoteId {
    /// Unique non guessable id (256bits)
    pub id: [u8; 32],
}

impl FromStr for NoteId {
    type Err = Box<str>;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        base64::prelude::BASE64_URL_SAFE_NO_PAD
            .decode(s)
            .map_err(|err| err.to_string().into_boxed_str())
            .and_then(|vec| {
                Ok(NoteId {
                    id: vec
                        .try_into()
                        .map_err(|_| "bad size".to_string().into_boxed_str())?,
                })
            })
    }
}

impl ToString for NoteId {
    fn to_string(&self) -> String {
        base64::prelude::BASE64_URL_SAFE_NO_PAD.encode(&self.id)
    }
}

impl NoteId {
    fn generate() -> Self {
        Self {
            id: rand::rng().random(),
        }
    }
}

#[derive(Debug)]
pub struct NoteContent {
    pub data: Bytes,
    /// Number of seconds before this note is removed, 0 for no expiration
    pub expires_after: u32,
    /// Number of views before this note is removed, 0 for no limits
    pub remaining_views: u32,
}

const fn note_memory_usage(data: &Bytes) -> Size {
    const NOTE_BASE_MEMORY_USAGE: usize = size_of::<NoteId>() * 3
        + size_of::<NoteCreatedAt>() * 2
        + size_of::<NoteExpireAt>()
        + size_of::<NoteContent>();
    Size {
        bytes: data.len() + NOTE_BASE_MEMORY_USAGE,
    }
}

impl NoteContent {
    pub const fn note_memory_usage(&self) -> Size {
        note_memory_usage(&self.data)
    }
}

#[derive(Debug, Clone)]
pub struct NoteReadContent {
    pub data: Bytes,
    /// Number of seconds before this note is removed
    pub expires_after: Option<u32>,
    /// Number of views before this note is removed
    pub remaining_views: Option<u32>,
}

impl NoteReadContent {
    pub const fn note_memory_usage(&self) -> Size {
        note_memory_usage(&self.data)
    }
}

impl NoteContent {
    fn expire_at(&self, created_at: NoteCreatedAt) -> Option<NoteExpireAt> {
        if self.expires_after > 0 {
            Some(NoteExpireAt(
                created_at.0 + Duration::from_secs(self.expires_after.into()),
            ))
        } else {
            None
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct NoteCreatedAt(Instant);
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct NoteExpireAt(Instant);

#[derive(Debug)]
struct DatabaseSlot {
    /// Notes (created_at, instant) sorted by created_at order
    notes: VecDeque<(NoteCreatedAt, NoteId)>,
    stats: DatabaseSlotStats,
}

#[derive(Debug, Clone, Copy)]
struct DatabaseSlotIdx(pub usize);

#[derive(Debug)]
pub struct DatabaseInner {
    notes_by_id: HashMap<NoteId, (DatabaseSlotIdx, NoteCreatedAt, NoteContent)>,
    /// Note ids sorted by expiration order
    expiring_notes: BTreeMap<NoteExpireAt, NoteId>,
}

#[derive(Debug)]
pub struct Database {
    inner: DatabaseInner,
    /// Non empty, ordered by max_note_size
    slots: Vec<DatabaseSlot>,
}

#[derive(Debug, Clone, Copy)]
pub struct DatabaseSlotStats {
    /// Sum of notes sizes (ie. memory usage)
    pub memory_usage: Size,
    /// Maximum note size to be in this slot
    pub max_note_size: Size,
    /// Maximum memory usage in bytes of this slot
    pub max_memory_usage: Size,
}

impl Database {
    pub fn new(slots: &[ConfigFileSlot]) -> Self {
        Self {
            inner: DatabaseInner {
                notes_by_id: Default::default(),
                expiring_notes: Default::default(),
            },
            slots: slots
                .iter()
                .map(|slot| DatabaseSlot {
                    notes: Default::default(),
                    stats: DatabaseSlotStats {
                        memory_usage: Size { bytes: 0 },
                        max_note_size: Size {
                            bytes: slot.max_note_size.bytes,
                        },
                        max_memory_usage: Size {
                            bytes: slot.max_memory_usage.bytes,
                        },
                    },
                })
                .collect(),
        }
    }

    fn slot_mut(
        slots: &mut Vec<DatabaseSlot>,
        note_memory_usage: Size,
    ) -> Option<(DatabaseSlotIdx, &mut DatabaseSlot)> {
        match slots.binary_search_by_key(&note_memory_usage, |slot| slot.stats.max_note_size) {
            Ok(index) | Err(index) => slots
                .get_mut(index)
                .map(|slot| (DatabaseSlotIdx(index), slot)),
        }
    }

    pub fn add_note(&mut self, content: NoteContent) -> Result<NoteId, &'static str> {
        let now = Instant::now();
        self.collect_expired_notes(now);

        let note_memory_usage = content.note_memory_usage();
        let (slot_idx, slot) =
            Self::slot_mut(&mut self.slots, note_memory_usage).ok_or_else(|| "note too big")?;

        let note_id = loop {
            let id = NoteId::generate();
            if !self.inner.notes_by_id.contains_key(&id) {
                break id;
            }
            // collision, try again
        };

        let created_at = {
            // force created_at to be unique and incremental
            let mut created_at =
                NoteCreatedAt(match slot.notes.back().filter(|(at, _)| at.0 >= now) {
                    Some((at, _)) => at.0 + Duration::from_nanos(1),
                    None => now,
                });

            // force expired_at to be unique, by incrementing created_at a little
            if content.expires_after > 0 {
                loop {
                    let pop_expire_at = NoteExpireAt(
                        created_at.0 + Duration::from_secs(content.expires_after.into()),
                    );
                    if !self.inner.expiring_notes.contains_key(&pop_expire_at) {
                        break;
                    }
                    created_at.0 += Duration::from_nanos(1);
                }
            }
            created_at
        };

        let reclaimed = Self::reclaim_memory_to_fit_note(&mut self.inner, slot, note_memory_usage);

        // insertion

        if let Some(expire_at) = content.expire_at(created_at) {
            self.inner.expiring_notes.insert(expire_at, note_id);
        }
        slot.notes.push_back((created_at, note_id));
        self.inner
            .notes_by_id
            .insert(note_id, (slot_idx, created_at, content));
        slot.stats.memory_usage.bytes += note_memory_usage.bytes;

        for reclaimed_note_memory_usage in reclaimed {
            self.log_event("reclaim note to fit", '-', reclaimed_note_memory_usage);
        }
        self.log_event("new  note", '+', note_memory_usage);
        Ok(note_id)
    }

    pub fn collect_expired_notes(&mut self, now: Instant) {
        while let Some(e) = self
            .inner
            .expiring_notes
            .first_entry()
            .filter(|e| e.key().0 < now)
        {
            // note expired
            let pop_id: NoteId = e.remove(); //< pop_from_expiring_notes
            let (pop_slot_idx, pop_at, pop_content) =
                Self::pop_from_notes_by_id(&mut self.inner.notes_by_id, &pop_id);
            let slot = &mut self.slots[pop_slot_idx.0];
            Self::pop_from_notes(&mut slot.notes, &pop_at);
            Self::pop_done(&mut slot.stats.memory_usage, &pop_content);
            self.log_event("collect expired note", '-', pop_content.note_memory_usage());
        }
    }

    fn reclaim_memory_to_fit_note(
        inner: &mut DatabaseInner,
        slot: &mut DatabaseSlot,
        note_memory_usage: Size,
    ) -> Vec<Size> {
        let mut reclaimed = Vec::new();
        assert!(note_memory_usage <= slot.stats.max_memory_usage);
        while !slot.notes.is_empty()
            && slot.stats.memory_usage + note_memory_usage > slot.stats.max_memory_usage
        {
            let pop_id: NoteId = slot.notes.pop_front().expect("note").1; //< pop_from_notes
            let (_pop_slot_idx, pop_at, pop_content) =
                Self::pop_from_notes_by_id(&mut inner.notes_by_id, &pop_id);
            Self::pop_from_expiring_notes(&mut inner.expiring_notes, pop_at, &pop_content);
            Self::pop_done(&mut slot.stats.memory_usage, &pop_content);
            reclaimed.push(pop_content.note_memory_usage());
        }
        reclaimed
    }

    pub fn read_note(&mut self, note_id: NoteId) -> Option<NoteReadContent> {
        let now = Instant::now();
        self.collect_expired_notes(now);
        let mut entry = match self.inner.notes_by_id.entry(note_id) {
            Entry::Occupied(occupied_entry) => occupied_entry,
            Entry::Vacant(_vacant_entry) => return None,
        };
        let &mut (_slot_idx, created_at, ref mut content) = entry.get_mut();
        if content.remaining_views > 0 {
            content.remaining_views -= 1;
            if content.remaining_views == 0 {
                // remove
                let (pop_slot_idx, pop_at, pop_content) = entry.remove(); //< pop_from_notes_by_id
                Self::pop_from_expiring_notes(&mut self.inner.expiring_notes, pop_at, &pop_content);
                let slot = &mut self.slots[pop_slot_idx.0];
                Self::pop_from_notes(&mut slot.notes, &created_at);
                Self::pop_done(&mut slot.stats.memory_usage, &pop_content);
                self.log_event("read note (expired)", '-', pop_content.note_memory_usage());
                return Some(NoteReadContent {
                    data: pop_content.data.clone(), // cheap clone
                    expires_after: None,
                    remaining_views: Some(0), // expired
                });
            }
        }

        let note = NoteReadContent {
            data: content.data.clone(), // cheap clone
            expires_after: if content.expires_after > 0 {
                let elapsed_secs: u32 = (now - created_at.0)
                    .as_secs()
                    .try_into()
                    .unwrap_or_default();
                Some(content.expires_after.saturating_sub(elapsed_secs).max(1))
            } else {
                None
            },
            remaining_views: if content.remaining_views > 0 {
                Some(content.remaining_views)
            } else {
                None
            },
        };
        self.log_event("read note", ' ', note.note_memory_usage());
        Some(note)
    }

    fn pop_from_notes_by_id(
        notes_by_id: &mut HashMap<NoteId, (DatabaseSlotIdx, NoteCreatedAt, NoteContent)>,
        pop_id: &NoteId,
    ) -> (DatabaseSlotIdx, NoteCreatedAt, NoteContent) {
        notes_by_id.remove(pop_id).expect("note by id")
    }

    fn pop_from_notes(notes: &mut VecDeque<(NoteCreatedAt, NoteId)>, created_at: &NoteCreatedAt) {
        let pop_idx = notes
            .binary_search_by_key(created_at, |(at, _id)| *at)
            .expect("note by at");
        notes.remove(pop_idx);
    }

    fn pop_from_expiring_notes(
        expiring_notes: &mut BTreeMap<NoteExpireAt, NoteId>,
        pop_at: NoteCreatedAt,
        pop_content: &NoteContent,
    ) {
        if let Some(pop_expire_at) = pop_content.expire_at(pop_at) {
            expiring_notes
                .remove(&pop_expire_at)
                .expect("expiring note");
        }
    }

    fn pop_done(memory_usage: &mut Size, pop_content: &NoteContent) {
        memory_usage.bytes -= pop_content.note_memory_usage().bytes;
    }

    pub fn memory_usage(&self) -> Size {
        Size {
            bytes: self
                .slots
                .iter()
                .map(|slot| slot.stats.memory_usage.bytes)
                .sum(),
        }
    }

    pub fn max_memory_usage(&self) -> Size {
        Size {
            bytes: self
                .slots
                .iter()
                .map(|slot| slot.stats.max_memory_usage.bytes)
                .sum(),
        }
    }

    pub fn max_note_size(&self) -> Size {
        Size {
            bytes: self
                .slots
                .iter()
                .map(|slot| slot.stats.max_note_size.bytes)
                .sum(),
        }
    }

    pub fn slot_stats_iter(&self) -> impl ExactSizeIterator<Item = DatabaseSlotStats> {
        self.slots.iter().map(|slot| slot.stats)
    }

    fn log_event(&self, event: &str, action: char, note_memory_usage: Size) {
        use std::fmt::Write;

        let db_memory_usage = self.memory_usage();
        let max_memory_usage = self.max_memory_usage();
        let now = chrono::Local::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, false);
        let mut log = String::new();
        log.reserve(256);
        (|| -> std::fmt::Result {
            write!(&mut log, "{now}: {event:20} {action}{note_memory_usage:5}")?;
            for s in self.slot_stats_iter() {
                write!(
                    &mut log,
                    ",\t{:5}/{:5}[<{}]",
                    s.memory_usage, s.max_memory_usage, s.max_note_size
                )?;
            }
            write!(&mut log, ",\tsum = {db_memory_usage}/{max_memory_usage}")?;
            Ok(())
        }())
        .expect("write! to String to not fail");
        println!("{log}");
    }
}
