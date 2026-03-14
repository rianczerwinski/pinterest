#!/usr/bin/env bash
# Scan downloaded pinterest images for extension/format mismatches and rename.
# Usage: ./scripts/fix-extensions.sh [directory]
# Default directory: ~/Downloads/pinterest

set -euo pipefail

DIR="${1:-$HOME/Downloads/pinterest}"
FIXED=0
SKIPPED=0
ERRORS=0

if [[ ! -d "$DIR" ]]; then
  echo "Directory not found: $DIR"
  exit 1
fi

echo "Scanning $DIR for mismatched file extensions..."
echo ""

while IFS= read -r -d '' file; do
  mime=$(file -b --mime-type "$file" 2>/dev/null) || { ((ERRORS++)); continue; }

  case "$mime" in
    image/jpeg)  correct_ext=".jpg" ;;
    image/png)   correct_ext=".png" ;;
    image/gif)   correct_ext=".gif" ;;
    image/webp)  correct_ext=".webp" ;;
    image/svg+xml) correct_ext=".svg" ;;
    *)
      # Not a recognized image format — skip
      ((SKIPPED++))
      echo "SKIP  $file ($mime)"
      continue
      ;;
  esac

  current_ext=".${file##*.}"
  current_ext_lower=$(echo "$current_ext" | tr '[:upper:]' '[:lower:]')

  # Normalize .jpeg to .jpg for comparison
  [[ "$current_ext_lower" == ".jpeg" ]] && current_ext_lower=".jpg"

  if [[ "$current_ext_lower" != "$correct_ext" ]]; then
    # Build new filename: strip old extension, add correct one
    base="${file%.*}"
    new_file="${base}${correct_ext}"

    # Handle collision
    if [[ -e "$new_file" ]]; then
      new_file="${base}_renamed${correct_ext}"
    fi

    mv "$file" "$new_file"
    echo "FIXED $file -> $(basename "$new_file")"
    ((FIXED++))
  fi
done < <(find "$DIR" -type f \( -name '*.jpg' -o -name '*.jpeg' -o -name '*.png' -o -name '*.gif' -o -name '*.webp' \) -print0)

echo ""
echo "Done: $FIXED renamed, $SKIPPED skipped, $ERRORS errors"
