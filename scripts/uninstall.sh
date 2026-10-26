#!/bin/sh
set -eu
root="$HOME/.local/share/anthracite"
is_owned_link() {
  link_target=$(readlink "$1") || return 1
  case "$link_target" in "$root/"*/an) :;; *) return 1;; esac
  owned_version=${link_target#"$root/"}
  owned_version=${owned_version%/an}
  case "$owned_version" in [0-9]*) :;; *) return 1;; esac
  case "$owned_version" in *[!0-9A-Za-z.-]*) return 1;; esac
  [ ! -L "$root/$owned_version" ]
}
for name in an anthracite; do
  link="$HOME/.local/bin/$name"
  if [ -L "$link" ]; then
    if is_owned_link "$link"; then rm "$link"; fi
  fi
done
rc="${ZDOTDIR:-$HOME}/.zshrc"
if [ -f "$rc" ]; then
  stage=$(mktemp)
  trap 'rm -f "$stage"' EXIT HUP INT TERM
  awk '/^# >>> Anthracite local install >>>$/ { skip=1; next } /^# <<< Anthracite local install <<<$/{skip=0; next} !skip' "$rc" > "$stage"
  cat "$stage" > "$rc"
fi
printf '%s\n' 'Removed Anthracite command links and zsh completion block. Versions and preferences were retained.'
