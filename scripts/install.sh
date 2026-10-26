#!/bin/sh
set -eu
version=${1:-0.1.1}
case "$version" in ''|*[!0-9A-Za-z.-]*) printf '%s\n' 'Invalid release version.' >&2; exit 1;; esac
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) asset=an-macos-arm64;;
  Darwin-x86_64) asset=an-macos-x64;;
  Linux-x86_64) asset=an-linux-x64;;
  *) printf '%s\n' 'No release binary for this platform.' >&2; exit 1;;
esac
root="$HOME/.local/share/anthracite"
bin="$HOME/.local/bin"
destination="$root/$version"
# Refuse unrelated commands before downloading or changing the active version.
for name in an anthracite; do
  if [ -e "$bin/$name" ] || [ -L "$bin/$name" ]; then
    if [ ! -L "$bin/$name" ]; then printf 'Refusing to replace %s\n' "$bin/$name" >&2; exit 1; fi
    case "$(readlink "$bin/$name")" in
      "$root/"*/an) :;;
      *) printf 'Refusing to replace %s\n' "$bin/$name" >&2; exit 1;;
    esac
  fi
done
mkdir -p "$root" "$bin"
stage=$(mktemp -d "$root/.install.XXXXXX")
trap 'rm -rf "$stage"' EXIT HUP INT TERM
fetch() {
  if [ -n "${ANTHRACITE_RELEASE_DIR:-}" ]; then
    cp "$ANTHRACITE_RELEASE_DIR/$1" "$stage/$1"
  else
    curl -fLsS "https://github.com/danielbaars/anthracite/releases/download/v$version/$1" -o "$stage/$1"
  fi
}
sha256() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    sha256sum "$1" | awk '{print $1}'
  fi
}
fetch "$asset"
fetch SHA256SUMS
fetch LICENSE
fetch CREDITS.md
for file in "$asset" LICENSE CREDITS.md; do
  expected=$(awk -v name="$file" '$2 == name { print $1 }' "$stage/SHA256SUMS")
  case "$expected" in ''|*[!0-9a-fA-F]*) printf 'Invalid checksum for %s\n' "$file" >&2; exit 1;; esac
  [ "${#expected}" -eq 64 ] || exit 1
  actual=$(sha256 "$stage/$file")
  [ "$actual" = "$expected" ] || { printf 'Checksum mismatch for %s\n' "$file" >&2; exit 1; }
done
chmod 755 "$stage/$asset"
[ "$("$stage/$asset" --version)" = "$version" ] || { printf '%s\n' 'Binary version does not match requested release.' >&2; exit 1; }
# Version directories are immutable; identical reinstalls remain safe.
if [ -e "$destination" ] || [ -L "$destination" ]; then
  [ -d "$destination" ] && [ ! -L "$destination" ] || exit 1
  for file in an LICENSE CREDITS.md; do
    source=$file
    [ "$file" != an ] || source=$asset
    expected=$(awk -v name="$source" '$2 == name { print $1 }' "$stage/SHA256SUMS")
    [ "$(sha256 "$destination/$file")" = "$expected" ] || { printf 'Existing version differs: %s\n' "$destination/$file" >&2; exit 1; }
  done
else
  mkdir "$stage/payload"
  cp "$stage/$asset" "$stage/payload/an"
  cp "$stage/LICENSE" "$stage/CREDITS.md" "$stage/payload/"
  mv "$stage/payload" "$destination"
fi
SHELL=/bin/zsh "$destination/an" completion | sed 's/^compdef _an_yargs_completions an$/compdef _an_yargs_completions an anthracite/' > "$stage/completion.zsh"
grep -q '^compdef _an_yargs_completions an anthracite$' "$stage/completion.zsh"
cp "$stage/completion.zsh" "$destination/completion.zsh"
cp "$stage/completion.zsh" "$root/completion.zsh"
rc="${ZDOTDIR:-$HOME}/.zshrc"
mkdir -p "$(dirname "$rc")"
if [ -f "$rc" ]; then
  [ -e "$destination/zshrc.before" ] || { cp -p "$rc" "$destination/zshrc.before"; chmod 600 "$destination/zshrc.before"; }
  awk '/^# >>> Anthracite local install >>>$/ { skip=1; next } /^# <<< Anthracite local install <<<$/{skip=0; next} !skip' "$rc" > "$stage/zshrc"
else
  : > "$stage/zshrc"
fi
cat >> "$stage/zshrc" <<'COMPLETION'
# >>> Anthracite local install >>>
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) export PATH="$HOME/.local/bin:$PATH" ;;
esac
if (( ! $+functions[compdef] )); then
  autoload -Uz compinit
  compinit
fi
source "$HOME/.local/share/anthracite/completion.zsh"
# <<< Anthracite local install <<<
COMPLETION
# Preserve a user's dotfile symlink and its permissions.
cat "$stage/zshrc" > "$rc"
for name in an anthracite; do
  ln -s "$destination/an" "$bin/.$name.$$.tmp"
  mv -f "$bin/.$name.$$.tmp" "$bin/$name"
done
printf 'Installed Anthracite %s. Open a new terminal or add %s to PATH.\n' "$version" "$bin"
