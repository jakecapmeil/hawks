// One-way sync: the Worker POSTs a person's Personal-tab data here whenever
// they save, and this writes that row into the roster sheet. The sheet is
// never read back by the app — this is push-only, app -> sheet.
//
// Setup (in the Google Sheet this is bound to):
//   Extensions > Apps Script > paste this file as Code.gs > Deploy > New
//   deployment > type "Web app" > execute as "Me", access "Anyone with the
//   link". Copy the deployment URL.
//   Then: Project Settings > Script Properties > add SYNC_SECRET with a
//   random value. Set the same value as the Worker's SHEETS_SYNC_SECRET
//   (wrangler secret put SHEETS_SYNC_SECRET), and the deployment URL as
//   SHEETS_SYNC_URL.
//
// Matching: rows are matched by Track ID, never by the "LAST, First" name
// text (that format doesn't round-trip cleanly). A person with no Track ID
// set yet, or no matching row, is appended as a new row.

var SHEET_NAME = 'Sheet1'; // adjust to the roster tab's actual name

var COLUMN_MAP = {
  'Name': function(p) { return p.name; },
  'First Name': function(p) { return p.first_name; },
  'Class': function(p) { return p.class_year; },
  'Track ID': function(p) { return p.track_id; },
  'Date Entered': function(p) { return p.date_entered; },
  'Phone': function(p) { return p.phone; },
  'Email': function(p) { return p.email; },
  'Borough': function(p) { return p.borough; },
  'Home Address': function(p) { return p.home_address; },
  'Mon Out': function(p) { return p.out_mon; },
  'Tue Out': function(p) { return p.out_tue; },
  'Wed Out': function(p) { return p.out_wed; },
  'Thu Out': function(p) { return p.out_thu; },
  'Fri Out': function(p) { return p.out_fri; },
  'Notes': function(p) { return p.personal_notes; },
};

function doPost(e) {
  var body = JSON.parse(e.postData.contents);
  var expected = PropertiesService.getScriptProperties().getProperty('SYNC_SECRET');
  if (!expected || body.secret !== expected) {
    return ContentService.createTextOutput('forbidden').setMimeType(ContentService.MimeType.TEXT);
  }

  var p = body.person;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  var data = sheet.getDataRange().getValues();
  var header = data[0];
  var trackIdCol = header.indexOf('Track ID');

  var rowIndex = -1;
  if (trackIdCol !== -1 && p.track_id) {
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][trackIdCol]) === String(p.track_id)) { rowIndex = i; break; }
    }
  }
  if (rowIndex === -1) rowIndex = data.length; // append a new row

  header.forEach(function(colName, colIdx) {
    var getValue = COLUMN_MAP[colName];
    if (!getValue) return;
    var value = getValue(p);
    if (value === undefined || value === null) return;
    sheet.getRange(rowIndex + 1, colIdx + 1).setValue(value);
  });

  return ContentService.createTextOutput('ok').setMimeType(ContentService.MimeType.TEXT);
}
