// Inlined so it survives single-file binary compilation (no runtime file read).
export const FISH_COMPLETION = String.raw`### Installation: ch fish >> ~/.config/fish/completions/ch.fish
function __ch_command_completions
    set -lx SHELL (type -p fish)
    set -l tokens (commandline -opc)
    set -l current (commandline -ct)
    # Keep the program token and current word in yargs' completion protocol.
    $tokens[1] --get-yargs-completions $tokens "$current"
end

# The CLI owns command, option and branch selection, including --cwd and get/g.
complete -c ch -f -a "(__ch_command_completions)"
`;
