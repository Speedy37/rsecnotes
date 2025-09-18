use std::process::Command;

fn main() {
    // Re-run build.rs if any TS files change
    println!("cargo:rerun-if-changed=client/");

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
}
