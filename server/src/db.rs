use std::collections::hash_map::Entry;
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::str::FromStr;
use std::time::{Duration, Instant};

use axum::body::Bytes;
use base64::Engine;
use rand::Rng;

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

#[derive(Debug, Clone)]
pub struct NoteReadContent {
    pub data: Bytes,
    /// Number of seconds before this note is removed
    pub expires_after: Option<u32>,
    /// Number of views before this note is removed
    pub remaining_views: Option<u32>,
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
pub struct Database {
    notes_by_id: HashMap<NoteId, (NoteCreatedAt, NoteContent)>,
    /// Notes (created_at, instant) sorted by created_at order
    notes: VecDeque<(NoteCreatedAt, NoteId)>,
    /// Note ids sorted by expiration order
    expiring_notes: BTreeMap<NoteExpireAt, NoteId>,
    /// Sum of notes sizes (ie. memory usage)
    memory_usage: usize,
    max_memory_usage: usize,
}

impl Database {
    pub fn new(max_memory_usage: usize) -> Self {
        Self {
            notes_by_id: Default::default(),
            notes: Default::default(),
            expiring_notes: Default::default(),
            memory_usage: 0,
            max_memory_usage,
        }
    }

    const fn note_memory_usage(content: &NoteContent) -> usize {
        const NOTE_BASE_MEMORY_USAGE: usize = size_of::<NoteId>() * 3
            + size_of::<NoteCreatedAt>() * 2
            + size_of::<NoteExpireAt>()
            + size_of::<NoteContent>();
        content.data.len() + NOTE_BASE_MEMORY_USAGE
    }

    pub fn add_note(&mut self, content: NoteContent) -> Result<NoteId, &'static str> {
        let note_memory_usage = Self::note_memory_usage(&content);
        if note_memory_usage > self.max_memory_usage {
            // error
            return Err("note too big");
        }

        let note_id = loop {
            let id = NoteId::generate();
            if !self.notes_by_id.contains_key(&id) {
                break id;
            }
            // collision, try again
        };

        let now = Instant::now();

        let created_at = {
            // force created_at to be unique and incremental
            let mut created_at =
                NoteCreatedAt(match self.notes.back().filter(|(at, _)| at.0 >= now) {
                    Some((at, _)) => at.0 + Duration::from_nanos(1),
                    None => now,
                });

            // force expired_at to be unique, by incrementing created_at a little
            if content.expires_after > 0 {
                loop {
                    let pop_expire_at = NoteExpireAt(
                        created_at.0 + Duration::from_secs(content.expires_after.into()),
                    );
                    if !self.expiring_notes.contains_key(&pop_expire_at) {
                        break;
                    }
                    created_at.0 += Duration::from_nanos(1);
                }
            }
            created_at
        };

        self.collect_expired_notes(now);
        self.reclaim_memory_to_fit_note(note_memory_usage);

        // insertion

        if let Some(expire_at) = content.expire_at(created_at) {
            self.expiring_notes.insert(expire_at, note_id);
        }
        self.notes.push_back((created_at, note_id));
        self.notes_by_id.insert(note_id, (created_at, content));
        self.memory_usage += note_memory_usage;
        Ok(note_id)
    }

    fn collect_expired_notes(&mut self, now: Instant) {
        while let Some(e) = self
            .expiring_notes
            .first_entry()
            .filter(|e| e.key().0 < now)
        {
            // note expired
            let pop_id: NoteId = e.remove(); //< pop_from_expiring_notes
            let (pop_at, pop_content) = Self::pop_from_notes_by_id(&mut self.notes_by_id, &pop_id);
            Self::pop_from_notes(&mut self.notes, &pop_at);
            Self::pop_done(&mut self.memory_usage, &pop_content);
        }
    }

    fn reclaim_memory_to_fit_note(&mut self, note_memory_usage: usize) {
        assert!(note_memory_usage <= self.max_memory_usage);
        while !self.notes_by_id.is_empty()
            && self.memory_usage + note_memory_usage > self.max_memory_usage
        {
            let pop_id: NoteId = self.notes.pop_front().expect("note").1; //< pop_from_notes
            let (pop_at, pop_content) = Self::pop_from_notes_by_id(&mut self.notes_by_id, &pop_id);
            Self::pop_from_expiring_notes(&mut self.expiring_notes, pop_at, &pop_content);
            Self::pop_done(&mut self.memory_usage, &pop_content);
        }
    }

    pub fn read_note(&mut self, note_id: NoteId) -> Option<NoteReadContent> {
        let now = Instant::now();
        self.collect_expired_notes(now);
        let mut entry = match self.notes_by_id.entry(note_id) {
            Entry::Occupied(occupied_entry) => occupied_entry,
            Entry::Vacant(_vacant_entry) => return None,
        };
        let &mut (created_at, ref mut content) = entry.get_mut();
        if content.remaining_views > 0 {
            content.remaining_views -= 1;
            if content.remaining_views == 0 {
                // remove
                let (pop_at, pop_content) = entry.remove(); //< pop_from_notes_by_id
                Self::pop_from_expiring_notes(&mut self.expiring_notes, pop_at, &pop_content);
                Self::pop_from_notes(&mut self.notes, &created_at);
                Self::pop_done(&mut self.memory_usage, &pop_content);
                return Some(NoteReadContent {
                    data: pop_content.data.clone(), // cheap clone
                    expires_after: None,
                    remaining_views: Some(0), // expired
                });
            }
        }

        Some(NoteReadContent {
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
        })
    }

    fn pop_from_notes_by_id(
        notes_by_id: &mut HashMap<NoteId, (NoteCreatedAt, NoteContent)>,
        pop_id: &NoteId,
    ) -> (NoteCreatedAt, NoteContent) {
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

    fn pop_done(memory_usage: &mut usize, pop_content: &NoteContent) {
        *memory_usage -= Self::note_memory_usage(&pop_content);
    }
}
