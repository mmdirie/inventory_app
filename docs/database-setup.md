# Database setup and tests

## Fresh database

Configure MySQL connection settings in `.env`, select an empty database with `DB_NAME`, then run:

```powershell
npm run setup
```

Fresh setup creates the schema only. It refuses to run if the selected database already has any tables and does not seed sample or business data. To add optional bootstrap/sample records after reviewing the data and setting unique `SEED_*_PASSWORD` values (at least 12 characters each), run `npm run seed`. The guarded seeder refuses databases where any protected application table already contains records.

Direct SQL seeding is disabled; use the guarded command rather than bypassing its checks.

## Existing databases

Run `npm run migrate` to apply forward-only migrations recorded in `schema_migrations`. A complete existing schema is baselined without replaying initial table creation; subsequent migrations are applied in order. The document-sequence migration initializes counters from recognizable historical year/sequence numbers so newly generated references do not restart at one. References in nonstandard formats are preserved but cannot be reconciled automatically; if a generated number conflicts with one, stop writes and manually advance the matching `document_sequences` counter. A partially initialized schema stops with an error and preserves its existing application tables and records for manual reconciliation (the migration metadata table may be created). Review and back up the database using your normal operational process before applying migrations.

## Isolated tests

The MySQL integration tests require permission to create and drop databases. They refuse to run unless `TEST_DB_NAME` is distinct from `DB_NAME` and starts with `inventory_app_test_`. The test runner creates uniquely named disposable databases under that prefix, and removes only those generated databases afterward. Do not point `TEST_DB_NAME` at a real or shared database.

```powershell
$env:TEST_DB_NAME = 'inventory_app_test_local'
npm test
Remove-Item Env:TEST_DB_NAME
```

Without `TEST_DB_NAME`, only database-free tests run and the integration suite is reported as skipped.
