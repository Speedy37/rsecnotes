<h1>
    <img src="./public/icon.svg" width="32" height="32" />
    <span>r</span><span style="margin-left: 0.25rem; color: #ffc832;">sec</span><span style="margin-left: 0.25rem; color: #083bb5;">notes</span>
</h1>

A secure sharing note and/or file(s) service, inspired by [cryptgeon](https://github.com/cupcakearmy/cryptgeon).

## Features

- Single binary server
- Notes are encrypted/decrypted by the browser, the encryption key never reach the server.
- Notes are stored in memory
- A note can contain both text and files
- JSON server configuration file
- Drag & drop files
- 1 to 1 memory consuption (a 1GB file will take 1GB of memory, no base64 or similar)
- Translated in french and english


## Getting Started

```
Usage: rsecnotes.exe [OPTIONS]

Options:
      --port <PORT>
          Listen port [default: 3000]
      --max-memory-usage <MAX_MEMORY_USAGE>
          Maximum memory usage in bytes [default: 1GiB]
      --max-note-size <MAX_NOTE_SIZE>
          Maximum final size of a note in bytes (after encryption and packaging) [default: 32MiB]
      --max-files <MAX_FILES>
          Maximum number of files, 0 means no file allowed [default: 4294967295]
      --default-expires-after <DEFAULT_EXPIRES_AFTER>
          Number of seconds before this note is removed, 0 for never [default: 0]
      --default-remaining-views <DEFAULT_REMAINING_VIEWS>
          Number of views before this note is removed, 0 for never [default: 1]
      --min-remaining-views <MIN_REMAINING_VIEWS>
          Minimal number of views before this note is removed [default: 0]
      --max-remaining-views <MAX_REMAINING_VIEWS>
          Maximal number of views before this note is removed, 0 for no limits [default: 0]
      --min-expires-after <MIN_EXPIRES_AFTER>
          Minimal number of seconds before this note is removed [default: 0]
      --max-expires-after <MAX_EXPIRES_AFTER>
          Maximal number of seconds before this note is removed, 0 for no limits [default: 86400]
  -h, --help
          Print help
```

## Contributing

Contributions are welcome! Please open issues or submit pull requests.

### How to build

```sh
cargo build
```

### How to iterate

```sh
cargo watch -x run
```

## Internals

### Encapsulation format

```
encrypted_data =
    VERSION_1: u8
    IV: [u8; 12]
    crypto.subtle.encrypt(): [u8; _]
```
The encrypted buffer first byte is the version byte and must be `1` as we only supports one version.  
The next 12 bytes contains the AES-GCM-256 Initialization vector.  
The remaining bytes are the encrypted result of [`crypto.subtle.encrypt`](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt) with `{ name: "AES-GCM", iv }` as [`AesGcmParams`](https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams).


```
decrypted_data = 
    TEXT_LEN: u32le 
    TEXT: [u8; TEXT_LEN] 
    FILES_LEN: u32le 
    file: [FILE; FILES_LEN]
FILE =
    NAME_LEN: u32le
    NAME: [u8; NAME_LEN]
    SIZE: u64le
    DATA: [u8; SIZE]
```

The note id is a server generated unique random 256bits value, the note_id is stored in the url in base64url without padding.

The note encryption key is a browser generated via [`crypto.subtle.generateKey`](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/generateKey) AES-GCM-256 key, the key is stored in the [url hash](https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Fragment) in base64url without padding (The url hash is not sent to the server by the browser).

## License

This project is licensed under the MIT License.