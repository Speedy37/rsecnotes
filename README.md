# RSecNotes

A secure sharing note and or file(s) service, inspired by [cryptgeon](https://github.com/cupcakearmy/cryptgeon).

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



## Contributing

Contributions are welcome! Please open issues or submit pull requests.


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