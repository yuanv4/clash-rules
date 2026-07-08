trim() {
  local value="$1"
  value="${value#"${value%%[!$' \t\r\n']*}"}"
  value="${value%"${value##*[!$' \t\r\n']}"}"
  printf '%s' "$value"
}

normalize_rule_line() {
  local line
  line="$(trim "$1")"

  [[ -z "$line" ]] && return 1
  [[ "$line" == "payload:" ]] && return 1
  [[ "$line" == \#* || "$line" == \;* || "$line" == //* ]] && return 1

  if [[ "$line" == "- "* ]]; then
    line="$(trim "${line:2}")"
  fi

  if [[ ${#line} -ge 2 ]]; then
    local first="${line:0:1}"
    local last="${line: -1}"
    if { [[ "$first" == "'" && "$last" == "'" ]] || [[ "$first" == '"' && "$last" == '"' ]]; }; then
      line="$(trim "${line:1:${#line}-2}")"
    fi
  fi

  [[ -z "$line" ]] && return 1
  [[ "$line" =~ ^[A-Za-z0-9._-]+:[^,]+$ ]] && return 1
  [[ "$line" =~ ^payload[[:space:]]*: ]] && return 1

  printf '%s\n' "$line"
}

normalize_rule_file() {
  local path="$1"
  [[ -f "$path" ]] || return 0

  while IFS= read -r line || [[ -n "$line" ]]; do
    normalize_rule_line "$line" || true
  done < "$path"
}

fetch_remote_rules() {
  local url
  for url in "$@"; do
    [[ "$SKIP_REMOTE_RULES" -eq 1 ]] && continue

    local attempt
    for attempt in 1 2 3; do
      echo "Fetching $url (attempt $attempt/3)" >&2
      local tmp
      tmp="$(mktemp)"
      if curl -fsSL --max-time 60 "$url" -o "$tmp"; then
        while IFS= read -r line || [[ -n "$line" ]]; do
          normalize_rule_line "$line" || true
        done < "$tmp"
        rm -f "$tmp"
        break
      fi

      rm -f "$tmp"
      if [[ "$attempt" -eq 3 ]]; then
        echo "Failed to fetch $url" >&2
        return 1
      fi

      echo "Fetch failed for $url. Retrying in 2 seconds..." >&2
      sleep 2
    done
  done
}

unique_rules() {
  awk '
    {
      key = tolower($0)
      if (key != "" && !seen[key]++) print
    }
  '
}

remove_excluded_rules() {
  local exclude_file="$1"
  if [[ ! -s "$exclude_file" ]]; then
    cat
    return 0
  fi

  awk '
    NR == FNR {
      line = $0
      sub(/^[ \t\r\n]+/, "", line)
      sub(/[ \t\r\n]+$/, "", line)
      if (line != "") excluded[tolower(line)] = 1
      next
    }
    {
      line = $0
      sub(/^[ \t\r\n]+/, "", line)
      sub(/[ \t\r\n]+$/, "", line)
      if (!excluded[tolower(line)]) print
    }
  ' "$exclude_file" -
}

write_rules_file() {
  local path="$1"
  local rules_file="$2"

  {
    printf 'payload:\n'
    while IFS= read -r rule || [[ -n "$rule" ]]; do
      [[ -z "$rule" ]] && continue
      printf '  - %s\n' "$rule"
    done < "$rules_file"
  } > "$path"
}
