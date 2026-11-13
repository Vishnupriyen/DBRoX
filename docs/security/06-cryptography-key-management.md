# Cryptography and Key Management Policy

| Version | Owner | Approved (sign and date) | Next review |
|---|---|---|---|
| 1.0 draft, 13 Nov 2026 | R. Vishnupriyen, founder | ______________________ | Nov 2027 |

## What is encrypted, how
| Data | How |
|---|---|
| Traffic | HTTPS only (Caddy, automatic certificates, HSTS) |
| PINs on the server | scrypt with a per-user salt |
| PINs on phones | never stored; a PBKDF2-SHA256 (100,000 rounds) salted hash for the offline login and app lock |
| Login token on Android | AES-256-GCM with a key in the Android Keystore (`SecurePlugin`) |
| Tokens | HMAC-SHA256 signed, with a key id; 14 days (owner) / 30 days (staff) |
| Licences | ECDSA P-256 signed; the app checks with the public key |
| Backups and the `.env` copy | `age` (X25519) to the founder's public key |
| Activity log | SHA-256 hash chain; the daily last hash is kept off the machine |

## Who holds which key
| Key | Where | Who |
|---|---|---|
| `JWT_SECRET` (+ `JWT_SECRET_OLD` during a change) | `deploy/.env` | server |
| `ADMIN_KEY`, `CRON_KEY`, `DB_PASSWORD`, `DB_APP_PASSWORD` | `deploy/.env` | server |
| Licence private key | `deploy/.env` + founder's offline copy | founder |
| Backup **private** key (age) | offline only: printed copy in a safe + password manager | founder |
| Backup public key | `deploy/.env` (`BACKUP_AGE_RECIPIENT`) | server |

## Rotation
- `ADMIN_KEY`, `CRON_KEY`: every quarter, and when anyone with access leaves.
- `JWT_SECRET`: every year — put the old value in `JWT_SECRET_OLD` for 30 days so phones renew without a logout.
- Backup key: checked every year in the restore drill; replaced if the paper or password-manager copy may be exposed
  (new key pair, new `BACKUP_AGE_RECIPIENT`, keep the old private key until the old backups have aged out).
- Licence key: only if exposed (all phones need the new public key in an app update).
