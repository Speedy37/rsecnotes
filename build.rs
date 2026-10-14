use std::fs;
use std::path::Path;
use std::process::Command;

/// tsc `outDir`
const TSC_OUT_DIR: &str = "target/client";

fn main() {
    // Re-run build.rs if any TS files change
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
    fs::write(Path::new("public/index.js"), index_js).expect("write public/index.js");
}
