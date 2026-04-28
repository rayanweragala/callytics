# Backup & Restore

## Exactly what a backup includes

`backend/src/backup/backup.service.ts` creates `.tar.gz` archives.

Always included:

- `database.dump`
  - format: PostgreSQL custom archive (`pg_dump -Fc`)
- `manifest.json`
  - includes `createdAt`, `includeRecordings`, backup `type`

Optional (when `includeRecordings=true`):

- `recordings.tar.gz`
  - created from `RECORDINGS_DIR` (default `/var/lib/asterisk/recording`)

## Restore sequence

`restoreBackup()` performs this order:

1. Validate uploaded file exists and ends with `.tar.gz`.
2. Stage upload into temp directory.
3. Extract archive with `tar -xzf`.
4. If DB restore selected:
   - require `database.dump`
   - run `pg_restore --clean --if-exists --no-owner --no-privileges ...`
   - rebuild managed telephony configs from DB state.
5. If recordings restore selected:
   - require `recordings.tar.gz`
   - clear recordings dir
   - extract recordings tar into recordings dir.
6. Restart affected runtime services through Docker socket API:
   - DB restore: `asterisk` + `stasis`
   - recordings-only restore: `asterisk`

## Where archives are stored before download

- Final backup files are written to `BACKUP_DIR` (default `/app/backups`, mounted as `callytics_backup_data`).
- Temporary workspaces use OS temp dirs via `fs.mkdtemp(...)` under `os.tmpdir()` and are removed after completion.

## Limitations from current implementation

- Backup archive includes DB dump + optional recordings + manifest only.
- It does not package arbitrary host files outside those artifacts.
- Restore requires selecting at least one target (`restoreDb` or `restoreRecordings`).
- DB restore and recordings restore are independent toggles; missing required artifact for a selected toggle fails restore.
