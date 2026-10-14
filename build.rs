use std::fs;
use std::path::Path;
use std::process::Command;

/// tsc `outDir`
const TSC_OUT_DIR: &str = "target/client";

fn main() {
    // Re-run build.rs if any client file changes
    println!("cargo:rerun-if-changed=client/");

    // Remove scripts of renamed or deleted sources
    match fs::remove_dir_all(TSC_OUT_DIR) {
        Err(err) if err.kind() != std::io::ErrorKind::NotFound => {
            panic!("failed to clean {TSC_OUT_DIR}: {err}")
        }
        _ => {}
    }

    // Run tsc
    let npm = if cfg!(target_os = "windows") {
        "npm.cmd"
    } else {
        "npm"
    };
    let status = Command::new(npm)
        .args(["run", "build"])
        .status()
        .expect("failed to run npm run build");

    if !status.success() {
        panic!("TypeScript compilation failed");
    }

    // Concatenate the plain scripts in file name order into a single, non minified, index.js
    let mut scripts: Vec<_> = fs::read_dir(TSC_OUT_DIR)
        .expect("tsc output directory")
        .map(|entry| entry.expect("tsc output entry").path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "js"))
        .collect();
    scripts.sort();
    let mut index_js = String::new();
    for script in scripts {
        let name = script.file_name().unwrap().to_string_lossy();
        index_js.push_str(&format!("// ---- {name} ----\n"));
        index_js.push_str(&fs::read_to_string(&script).expect("tsc output script"));
        if !index_js.ends_with('\n') {
            index_js.push('\n');
        }
    }

    // Inline index.css and index.js into index.html, allowed by the CSP through their hashes
    // Browsers hash inline blocks after the HTML parser normalized newlines to LF
    let index_css = fs::read_to_string("client/index.css").expect("client/index.css");
    let index_css = index_css.replace("\r\n", "\n").replace('\r', "\n");
    let index_js = index_js.replace("\r\n", "\n").replace('\r', "\n");
    let index_html = fs::read_to_string("client/index.html").expect("client/index.html");
    let index_html = inline(&index_html, r#"<link rel="stylesheet" href="index.css" />"#, "style", &index_css);
    let index_html = inline(&index_html, r#"<script src="index.js"></script>"#, "script", &index_js);
    let icon_svg = fs::read("client/icon.svg").expect("client/icon.svg");
    assert!(index_html.contains(r#""icon.svg""#), "index.html must reference icon.svg");
    let index_html = index_html.replace(r#""icon.svg""#, &format!(r#""{}""#, data_uri("image/svg+xml", &icon_svg)));
    println!("cargo:rustc-env=CSP_STYLE_HASH={}", csp_hash(&index_css));
    println!("cargo:rustc-env=CSP_SCRIPT_HASH={}", csp_hash(&index_js));
    let out_dir = std::env::var("OUT_DIR").expect("OUT_DIR");
    fs::write(Path::new(&out_dir).join("index.html"), index_html).expect("write index.html");
}

/// Replace `tag` in `html` by a `<{element}>` block holding `content`
fn inline(html: &str, tag: &str, element: &str, content: &str) -> String {
    assert_eq!(html.matches(tag).count(), 1, "index.html must contain {tag} once");
    // The block would end early, and its hash would not match
    assert!(
        !content.to_ascii_lowercase().contains(&format!("</{element}")),
        "inlined {element} must not contain </{element}"
    );
    html.replace(tag, &format!("<{element}>{content}</{element}>"))
}

fn data_uri(content_type: &str, content: &[u8]) -> String {
    use base64::Engine;
    format!("data:{content_type};base64,{}", base64::engine::general_purpose::STANDARD.encode(content))
}

/// CSP source allowing an inline block with exactly this content
fn csp_hash(content: &str) -> String {
    use base64::Engine;
    use sha2::Digest;
    let hash = sha2::Sha256::digest(content.as_bytes());
    format!("'sha256-{}'", base64::engine::general_purpose::STANDARD.encode(hash))
}
