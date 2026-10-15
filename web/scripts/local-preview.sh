#!/bin/sh
# Current-login local preview only. launchd owns its lifetime; no login/startup installation.
set -eu
preview_script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
preview_web_dir=$(CDPATH= cd -- "$preview_script_dir/.." && pwd)
preview_script="$preview_script_dir/local-preview.sh"
preview_hash=$(printf '%s' "$preview_web_dir" | shasum -a 256 | cut -c 1-12)
preview_label="local.zeirishi-coach.preview.$preview_hash"
preview_url='http://127.0.0.1:3210/'
preview_logs="$preview_web_dir/.local-data/preview"

if [ "${1:-}" = '_run' ]; then
  cd "$preview_web_dir"
  exec /usr/bin/env -i HOME="${HOME:-}" PATH='/usr/bin:/bin:/usr/sbin:/sbin' NODE_ENV=production TZ=Asia/Tokyo \
    ZEIRISHI_FIXTURE_MODE=1 ZEIRISHI_BOOKKEEPING_MVP=1 ZEIRISHI_SUPABASE_ENABLED=0 \
    ZEIRISHI_DATABASE_ENABLED=0 ZEIRISHI_LOCAL_CLI_PROVIDER='' \
    "$2" "$preview_web_dir/node_modules/next/dist/bin/next" start --hostname 127.0.0.1 --port 3210
fi
command -v launchctl >/dev/null || { printf 'この起動方法はmacOS用です。READMEの起動方法を使ってください。\n' >&2; exit 1; }

preview_job() { launchctl list "$preview_label" 2>/dev/null; }
preview_owned() {
  preview_description=$(preview_job) || return 1
  if printf '%s\n' "$preview_description" | awk -v script="$preview_script" '
    /^[[:space:]]*"ProgramArguments" = \($/ { inside=1; found++; next }
    inside && /^[[:space:]]*\);$/ { inside=0; next }
    inside {
      line=$0
      sub(/^[[:space:]]*/, "", line)
      sub(/;[[:space:]]*$/, "", line)
      args[++count]=line
    }
    END {
      exit !(found == 1 && count == 4 && args[1] == "\"/bin/sh\"" &&
        args[2] == "\"" script "\"" && args[3] == "\"_run\"" &&
        args[4] ~ /^"\/[^"\\]+"$/)
    }'; then return 0; fi
  printf '同名の処理をこの起動スクリプトと照合できません。\n' >&2
  return 1
}
preview_status() {
  if ! preview_owned; then printf 'preview_stopped label=%s\n' "$preview_label"; return 1; fi
  preview_pid=$(preview_job | awk '$1 == "\"PID\"" {gsub(/;/,"",$3); print $3}')
  preview_listener=$(lsof -nP -iTCP:3210 -sTCP:LISTEN -t 2>/dev/null | sort -u || true)
  preview_http=$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 2 "$preview_url" || true)
  printf 'preview_status pid=%s http=%s url=%s\n' "${preview_pid:-none}" "$preview_http" "$preview_url"
  [ -n "$preview_pid" ] && [ "$preview_listener" = "$preview_pid" ] && [ "$preview_http" = '200' ]
}
case "${1:-status}" in
  status) preview_status;;
  start)
    if preview_job >/dev/null; then preview_status; exit $?; fi
    if lsof -nP -iTCP:3210 -sTCP:LISTEN -t >/dev/null 2>&1; then
      printf '3210番ポートは別の処理が使用中です。停止や上書きはしません。\n' >&2; exit 1
    fi
    preview_node=$(node -p 'process.execPath')
    [ -f "$preview_web_dir/.next/BUILD_ID" ] || { printf '先にnpm run buildを実行してください。\n' >&2; exit 1; }
    mkdir -p "$preview_logs"
    launchctl submit -l "$preview_label" -o "$preview_logs/stdout.log" -e "$preview_logs/stderr.log" -- /bin/sh "$preview_script" _run "$preview_node"
    preview_tries=0
    while [ "$preview_tries" -lt 20 ]; do
      if preview_status >"$preview_logs/status.txt" 2>&1; then cat "$preview_logs/status.txt"; exit 0; fi
      preview_tries=$((preview_tries + 1)); sleep 1
    done
    cat "$preview_logs/status.txt" >&2; printf '起動を確認できません。ログを確認してください。\n' >&2; exit 1;;
  stop)
    if ! preview_job >/dev/null; then printf 'preview_stopped label=%s\n' "$preview_label"; exit 0; fi
    preview_owned || exit 1
    launchctl remove "$preview_label"
    printf 'preview_removed label=%s\n' "$preview_label";;
  *) printf '使い方: sh scripts/local-preview.sh start|status|stop\n' >&2; exit 2;;
esac
