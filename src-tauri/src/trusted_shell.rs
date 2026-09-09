use tauri::Webview;

pub const MAIN_SHELL_LABEL: &str = "main";
pub const STANDALONE_SHELL_PREFIX: &str = "standalone-";

pub fn is_trusted_shell_label(label: &str) -> bool {
    label == MAIN_SHELL_LABEL
        || label
            .strip_prefix(STANDALONE_SHELL_PREFIX)
            .is_some_and(|identity| {
                identity.len() == 16 && identity.bytes().all(|byte| byte.is_ascii_hexdigit())
            })
}

pub fn require_trusted_shell(caller: &Webview) -> Result<(), String> {
    if !is_trusted_shell_label(caller.label())
        || caller.window().label() != caller.label()
        || !is_trusted_shell_label(caller.window().label())
    {
        return Err("This native operation is restricted to a trusted Nammu shell.".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::is_trusted_shell_label;

    #[test]
    fn accepts_only_main_and_generated_standalone_shell_labels() {
        assert!(is_trusted_shell_label("main"));
        assert!(is_trusted_shell_label("standalone-0123456789abcdef"));
        assert!(!is_trusted_shell_label("standalone-browser"));
        assert!(!is_trusted_shell_label("standalone-0123456789abcdeg"));
        assert!(!is_trusted_shell_label("native-youtube-music-deadbeef"));
    }
}
