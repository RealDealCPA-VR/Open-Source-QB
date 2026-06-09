// One-off: extract the audit workflow's result JSON into audit-findings.json + print a summary.
const fs = require('fs');
const src = process.argv[2];
const obj = JSON.parse(fs.readFileSync(src, 'utf8')).result;
fs.writeFileSync(__dirname + '/../audit-findings.json', JSON.stringify(obj, null, 2));
let gaps = 0, bugs = 0;
for (const d of obj.confirmed) {
  gaps += d.gaps.length; bugs += d.bugs.length;
  console.log('== ' + d.domain + ' (' + d.gaps.length + ' gaps, ' + d.bugs.length + ' bugs)');
  for (const g of d.gaps) console.log('  GAP [' + g.severity + '/' + (g.effort || '?') + '] ' + g.title);
  for (const b of d.bugs) console.log('  BUG [' + b.severity + '] ' + b.title);
}
console.log('TOTAL', gaps, 'gaps,', bugs, 'bugs');
