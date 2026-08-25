import { loadDataSnapshot } from "../src/lib/data/load";

const snapshot = await loadDataSnapshot(process.argv[2]);
process.stdout.write(
  `Validated schema v${snapshot.schemasVersion.schemaVersion}: ${snapshot.items.length} items, ${snapshot.reports.length} reports, ${snapshot.events.length} events, ${snapshot.qualityReports.length} quality audits.\n`,
);
