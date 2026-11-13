#!/usr/bin/env bash
# Sends one alert to the founder: alert.sh <topic> <message>
# Works even when Hanubix itself is down (plain curl). Channels come from deploy/.env — set at least one:
#   Telegram (free):   ALERT_TELEGRAM_BOT_TOKEN, ALERT_TELEGRAM_CHAT_ID
#   WhatsApp Cloud:    ALERT_WHATSAPP_TOKEN, ALERT_WHATSAPP_PHONE_ID, ALERT_WHATSAPP_TO (founder's number, 91…),
#                      ALERT_WHATSAPP_TEMPLATE (an approved template with one body text field)
#   Email (record):    ALERT_EMAIL_TO, ALERT_SMTP_URL (smtps://user:password@host:465), ALERT_EMAIL_FROM
# Every alert is also written to deploy/alerts.log (the evidence folder keeps a monthly copy).
set -uo pipefail
cd "$(dirname "$0")"
[[ -f .env ]] && { set -a; source .env; set +a; }
TOPIC="${1:-alert}"; MSG="${2:-}"
HOST=$(hostname 2>/dev/null || echo server)
TEXT="[Hanubix ${HOST}] ${TOPIC}: ${MSG}"
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) ${TOPIC} ${MSG}" >> alerts.log
sent=0
json() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
if [[ -n "${ALERT_TELEGRAM_BOT_TOKEN:-}" && -n "${ALERT_TELEGRAM_CHAT_ID:-}" ]]; then
  curl -sS -m 20 -X POST "https://api.telegram.org/bot${ALERT_TELEGRAM_BOT_TOKEN}/sendMessage" \
    -H 'content-type: application/json' -d "{\"chat_id\":\"${ALERT_TELEGRAM_CHAT_ID}\",\"text\":\"$(json "$TEXT")\"}" >/dev/null && sent=1
fi
if [[ -n "${ALERT_WHATSAPP_TOKEN:-}" && -n "${ALERT_WHATSAPP_PHONE_ID:-}" && -n "${ALERT_WHATSAPP_TO:-}" ]]; then
  curl -sS -m 20 -X POST "https://graph.facebook.com/v20.0/${ALERT_WHATSAPP_PHONE_ID}/messages" \
    -H "authorization: Bearer ${ALERT_WHATSAPP_TOKEN}" -H 'content-type: application/json' \
    -d "{\"messaging_product\":\"whatsapp\",\"to\":\"${ALERT_WHATSAPP_TO}\",\"type\":\"template\",\"template\":{\"name\":\"${ALERT_WHATSAPP_TEMPLATE:-hanubix_alert}\",\"language\":{\"code\":\"en\"},\"components\":[{\"type\":\"body\",\"parameters\":[{\"type\":\"text\",\"text\":\"$(json "$TEXT")\"}]}]}}" >/dev/null && sent=1
fi
if [[ -n "${ALERT_EMAIL_TO:-}" && -n "${ALERT_SMTP_URL:-}" ]]; then
  printf 'From: %s\r\nTo: %s\r\nSubject: %s\r\n\r\n%s\r\n' "${ALERT_EMAIL_FROM:-alerts@localhost}" "$ALERT_EMAIL_TO" "Hanubix alert: $TOPIC" "$TEXT" \
    | curl -sS -m 30 --ssl-reqd --url "$ALERT_SMTP_URL" --mail-from "${ALERT_EMAIL_FROM:-alerts@localhost}" --mail-rcpt "$ALERT_EMAIL_TO" -T - >/dev/null && sent=1
fi
if (( sent == 0 )); then
  echo "⚠ ALERT (no alert channel set in deploy/.env, or it failed): $TEXT" >&2
fi
exit 0
