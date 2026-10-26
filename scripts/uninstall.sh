#!/bin/sh
set -eu
root="$HOME/.local/share/anthracite"
for name in an anthracite; do
  link="$HOME/.local/bin/$name"
  if [ -L "$link" ]; then
    case "$(readlink "$link")" in "$root/"*/an) rm "$link";; esac
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
