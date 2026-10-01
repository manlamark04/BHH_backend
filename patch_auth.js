const fs = require('fs');

// Patch auth.service.js
const authFile = 'src/services/auth.service.js';
let authCode = fs.readFileSync(authFile, 'utf8');

authCode = authCode.split("const db   = require('../db/procedures');").join(
`const db   = require('../db/procedures');
const { notifyStaffAndAdmin } = require('./notification.emitter');`);

authCode = authCode.split("res.status(201).json({").join(
`notifyStaffAndAdmin();
    res.status(201).json({`);

fs.writeFileSync(authFile, authCode);
console.log('Patched auth.service.js');

// Patch user.service.js
const userFile = 'src/services/user.service.js';
let userCode = fs.readFileSync(userFile, 'utf8');

userCode = userCode.split("const db   = require('../db/procedures');").join(
`const db   = require('../db/procedures');
const { notifyStaffAndAdmin, notifyUser } = require('./notification.emitter');`);

userCode = userCode.split("res.json({ message: 'User approved'").join(
`notifyUser(req.params.id);
    notifyStaffAndAdmin();
    res.json({ message: 'User approved'`);

userCode = userCode.split("res.json({ message: 'User rejected'").join(
`notifyStaffAndAdmin();
    res.json({ message: 'User rejected'`);

fs.writeFileSync(userFile, userCode);
console.log('Patched user.service.js');
