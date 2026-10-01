const fs = require('fs');

const file = 'src/services/booking.service.js';
let code = fs.readFileSync(file, 'utf8');

const replacements = [
  { search: "res.status(201).json({ message: 'Booking requested successfully'", replace: "notifyStaffAndAdmin();\\n    res.status(201).json({ message: 'Booking requested successfully'" },
  { search: "res.json({ message: 'Booking approved'", replace: "notifyStaffAndAdmin();\\n    res.json({ message: 'Booking approved'" },
  { search: "res.json({ message: 'Booking rejected'", replace: "notifyStaffAndAdmin();\\n    res.json({ message: 'Booking rejected'" },
  { search: "res.json({ message: 'Booking cancelled'", replace: "notifyStaffAndAdmin();\\n    res.json({ message: 'Booking cancelled'" },
  { search: "res.json({ message: 'Booking updated'", replace: "notifyStaffAndAdmin();\\n    res.json({ message: 'Booking updated'" },
  { search: "res.json({ message: 'Booking status updated to", replace: "notifyStaffAndAdmin();\\n    res.json({ message: 'Booking status updated to" },
  { search: "res.json({ message: 'Payment recorded successfully'", replace: "notifyStaffAndAdmin();\\n    res.json({ message: 'Payment recorded successfully'" }
];

replacements.forEach(({ search, replace }) => {
  code = code.split(search).join(replace.replace(/\\\\n/g, '\\n'));
});

fs.writeFileSync(file, code);
console.log('Patched booking.service.js');
