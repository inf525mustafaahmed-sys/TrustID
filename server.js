// ==================================================
// 🚀 TRUSTID HR SYSTEM - MASTER VERSION
// ==================================================

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const nodemailer = require('nodemailer');
const multer = require('multer'); 
const rateLimit = require('express-rate-limit'); 
const fs = require('fs');

const app = express();
const PORT = 3000;

// 🛡️ 1. إعداد الحماية
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, message: "⛔ تم حظر IP الخاص بك." }));

// 📸 2. إعداد الصور
const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage: storage });

// 📧 3. إعداد الإيميل
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'inf525.mustafa.ahmed@student.uobabylon.edu.iq',
        pass: 'fnux pdns fpnh qfdt'
    }
});

// 🗄️ 4. قاعدة البيانات (HR System)
const dbPath = path.join(__dirname, 'trustid.db');
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE);
db.run('PRAGMA journal_mode = WAL;');

// إنشاء الجداول
db.run(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT, email TEXT UNIQUE, password TEXT, role TEXT, job_title TEXT, department TEXT, start_time TEXT, status TEXT, profile_image TEXT, phone TEXT, address TEXT, hire_date TEXT, leave_balance INTEGER DEFAULT 21)`);
db.run(`CREATE TABLE IF NOT EXISTS attendance (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, date TEXT, check_in TEXT, check_out TEXT, status TEXT, note TEXT)`);
db.run(`CREATE TABLE IF NOT EXISTS salaries (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, month TEXT, base_salary INTEGER, bonus INTEGER, deduction INTEGER, total INTEGER, status TEXT)`);
db.run(`CREATE TABLE IF NOT EXISTS leaves (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, type TEXT, start_date TEXT, end_date TEXT, reason TEXT, status TEXT DEFAULT 'قيد المراجعة')`);
db.run(`CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, title TEXT, description TEXT, due_date TEXT, status TEXT DEFAULT 'قيد التنفيذ')`);
db.run(`CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, sender_id TEXT, receiver_id TEXT, subject TEXT, body TEXT, date TEXT, is_read INTEGER DEFAULT 0)`);
db.run(`CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, action TEXT, timestamp TEXT)`);

function logActivity(email, action) {
    const time = new Date().toLocaleString('en-US');
    db.run(`INSERT INTO logs (email, action, timestamp) VALUES (?, ?, ?)`, [email, action, time]);
}

// ⚙️ إعدادات السيرفر
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({ secret: 'trustid_hr_secret', resave: false, saveUninitialized: true }));

// ================= ROUTES =================

// --- التسجيل ---
app.post('/register', upload.single('photo'), (req, res) => {
    const { name, email, password, job_title, department, start_time } = req.body;
    const { v4: uuid } = require('uuid');
    const userId = uuid();
    const imagePath = req.file ? req.file.filename : 'default.png';
    const hireDate = new Date().toISOString().split('T')[0];

    db.run(`INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
    [userId, name, email, bcrypt.hashSync(password, 10), 'employee', job_title, department, start_time, 'نشط 🟢', imagePath, 'غير مسجل', 'غير مسجل', hireDate, 21], 
    (err) => {
        if (err) return res.send('❌ الإيميل مستخدم مسبقاً.');
        logActivity(email, 'إنشاء ملف وظيفي جديد');
        res.redirect('/login.html');
    });
});

// --- الدخول ---
app.post('/login', (req, res) => {
    const { email, password } = req.body;
    db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
        if (!user || !bcrypt.compareSync(password, user.password)) return res.send('❌ بيانات خاطئة');
        const otp = Math.floor(100000 + Math.random() * 900000);
        req.session.tempUser = user; req.session.otp = otp;
        try {
            await transporter.sendMail({ from: '"TrustID HR" <no-reply@trustid.com>', to: email, subject: '🔐 رمز الدخول', html: `<h1>${otp}</h1>` });
            res.send(`<body style="text-align:center; padding:50px;"><h2>تم إرسال الرمز</h2><form action="/verify" method="POST"><input name="code" placeholder="الرمز" required><button>دخول</button></form></body>`);
        } catch (e) { res.send('خطأ في الإرسال'); }
    });
});

// --- التحقق ---
app.post('/verify', (req, res) => {
    const { code } = req.body;
    if (req.session.otp && parseInt(code) === req.session.otp) {
        req.session.user = req.session.tempUser;
        delete req.session.tempUser; delete req.session.otp;
        logActivity(req.session.user.email, 'دخول للنظام');
        if (req.session.user.role === 'admin') res.redirect('/admin.html');
        else res.redirect('/dashboard');
    } else { res.send('رمز خاطئ'); }
});

// ==================================================
// 🔥 1. نظام الحضور اليدوي (Manual Attendance)
// ==================================================

app.post('/attendance/check-in', (req, res) => {
    if (!req.session.user) return res.redirect('/login.html');

    // 👇 ضع IP الدائرة الحكومية هنا (حالياً محلي ::1)
    const ALLOWED_IP = ['::1', '127.0.0.1']; 
    let userIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (userIp.includes('::ffff:')) userIp = userIp.split(':').pop();

    // 🛑 فك التعليق لتفعيل الحماية
    /* if (!ALLOWED_IP.includes(userIp)) {
         return res.send(`<h2 style="color:red;text-align:center">⛔ يجب أن تكون داخل الدائرة لتسجيل الحضور</h2>`);
    } */

    const userId = req.session.user.id;
    const today = new Date().toISOString().split('T')[0];
    const now = new Date().toLocaleTimeString('en-US');

    db.get(`SELECT * FROM attendance WHERE user_id = ? AND date = ?`, [userId, today], (err, row) => {
        if (row) return res.send('⚠️ تم التسجيل مسبقاً.');
        db.run(`INSERT INTO attendance (user_id, date, check_in, status) VALUES (?, ?, ?, ?)`, 
        [userId, today, now, 'حاضر ✅'], () => {
            logActivity(req.session.user.email, 'تسجيل حضور يدوي');
            res.redirect('/dashboard');
        });
    });
});

app.post('/attendance/check-out', (req, res) => {
    if (!req.session.user) return res.redirect('/login.html');
    const userId = req.session.user.id;
    const today = new Date().toISOString().split('T')[0];
    const now = new Date().toLocaleTimeString('en-US');

    db.run(`UPDATE attendance SET check_out = ? WHERE user_id = ? AND date = ?`, [now, userId, today], () => {
        logActivity(req.session.user.email, 'تسجيل انصراف يدوي');
        res.redirect('/dashboard');
    });
});

// ==================================================
// 📸 2. نظام الحضور بالكاميرا (Camera Scanner API)
// ==================================================

app.post('/api/scan-attendance', (req, res) => {
    const { qrData } = req.body;
    let userId = null;

    if (qrData.includes('ID:')) {
        const parts = qrData.split('|');
        const idPart = parts.find(p => p.trim().startsWith('ID:'));
        if (idPart) userId = idPart.split(':')[1].trim();
    } else {
        userId = qrData.trim();
    }

    if (!userId) return res.json({ success: false, message: 'كود غير صالح ❌' });

    db.get(`SELECT * FROM users WHERE id = ?`, [userId], (err, user) => {
        if (!user) return res.json({ success: false, message: 'مستخدِم غير موجود 🚫' });

        const today = new Date().toISOString().split('T')[0];
        const now = new Date().toLocaleTimeString('en-US');

        db.get(`SELECT * FROM attendance WHERE user_id = ? AND date = ?`, [userId, today], (err, row) => {
            if (!row) {
                db.run(`INSERT INTO attendance (user_id, date, check_in, status) VALUES (?, ?, ?, ?)`, 
                [userId, today, now, 'حاضر ✅'], () => {
                    logActivity(user.email, 'تسجيل حضور بالكاميرا 📸');
                    res.json({ success: true, message: 'تم تسجيل الحضور ✅', name: user.name });
                });
            } else if (!row.check_out) {
                db.run(`UPDATE attendance SET check_out = ? WHERE user_id = ? AND date = ?`, [now, userId, today], () => {
                    logActivity(user.email, 'تسجيل انصراف بالكاميرا 📸');
                    res.json({ success: true, message: 'تم تسجيل الانصراف 👋', name: user.name });
                });
            } else {
                res.json({ success: false, message: 'تم تسجيل اليوم بالكامل 🛑' });
            }
        });
    });
});

// ==================================================
// 🏠 3. لوحة التحكم (Dashboard)
// ==================================================

app.get('/dashboard', (req, res) => {
    if (!req.session.user) return res.redirect('/login.html');
    const user = req.session.user;
    const today = new Date().toISOString().split('T')[0];

    // جلب حالة الحضور لتحديد الزر المناسب
    db.get(`SELECT * FROM attendance WHERE user_id = ? AND date = ?`, [user.id, today], (err, attendance) => {
        
        let attendanceBtn = '';
        let statusBadge = '<span class="badge" style="background:gray;">غير مسجل</span>';

        if (!attendance) {
            // الزر الأخضر
            attendanceBtn = `<form action="/attendance/check-in" method="POST"><button class="menu-btn" style="background:#2e7d32;">🟢 تسجيل حضور</button></form>`;
        } else if (!attendance.check_out) {
            // الزر الأحمر
            statusBadge = `<span class="badge" style="background:#2e7d32;">حاضر منذ ${attendance.check_in}</span>`;
            attendanceBtn = `<form action="/attendance/check-out" method="POST"><button class="menu-btn" style="background:#c62828;">🔴 تسجيل انصراف</button></form>`;
        } else {
            // انتهى
            statusBadge = `<span class="badge" style="background:#003366;">تم الانصراف ${attendance.check_out}</span>`;
            attendanceBtn = `<button class="menu-btn" disabled style="background:#555; cursor:not-allowed;">✅ انتهى دوام اليوم</button>`;
        }

        db.all(`SELECT * FROM tasks WHERE user_id = ?`, [user.id], (err, tasks) => {
            const tasksCount = tasks ? tasks.length : 0;
            const qrData = `Employee: ${user.name} | ID: ${user.id}`;
            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(qrData)}`;
            const userImg = user.profile_image === 'default.png' ? 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png' : `/uploads/${user.profile_image}`;

            res.send(`
                <!DOCTYPE html>
                <html dir="rtl">
                <head>
                    <title>بوابة الموظف</title>
                    <meta charset="UTF-8">
                    <style>
                        body { font-family: 'Segoe UI', sans-serif; background: #eef2f3; margin: 0; padding: 20px; }
                        .container { max-width: 850px; margin: 30px auto; background: white; border-radius: 15px; box-shadow: 0 10px 25px rgba(0,0,0,0.15); overflow: hidden; }
                        .header-section { background: linear-gradient(135deg, #003366 0%, #00509e 100%); color: white; padding: 25px; display: flex; justify-content: space-between; align-items: center; }
                        .profile-img { width: 110px; height: 110px; border-radius: 50%; border: 4px solid rgba(255,255,255,0.8); object-fit: cover; }
                        .qr-container { background: white; padding: 5px; border-radius: 5px; height: 110px; width: 110px; display: flex; align-items: center; justify-content: center; }
                        .qr-code { width: 100%; height: 100%; }
                        .content { padding: 30px; }
                        .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 25px; }
                        .stat-card { background: #f8f9fa; padding: 15px; border-radius: 8px; text-align: center; border-bottom: 3px solid #003366; }
                        .stat-val { font-size: 20px; font-weight: bold; color: #003366; }
                        .stat-lbl { font-size: 12px; color: #666; }
                        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
                        .info-box { background: white; padding: 10px; border-bottom: 1px solid #eee; }
                        .label { font-size: 11px; color: #888; font-weight: bold; }
                        .value { font-size: 14px; font-weight: bold; color: #333; }
                        .menu-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 30px; }
                        .menu-btn { background: #003366; color: white; border: none; padding: 15px; border-radius: 8px; cursor: pointer; transition: 0.3s; width: 100%; font-size: 14px; font-weight: bold; }
                        .menu-btn:hover { opacity: 0.9; }
                        .badge { padding: 5px 10px; border-radius: 15px; font-size: 12px; color: white; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="header-section">
                            <div style="display:flex; gap:15px; align-items:center; text-align:right;">
                                <img src="${userImg}" class="profile-img">
                                <div>
                                    <div style="font-size:22px; font-weight:bold;">${user.name}</div>
                                    <div style="font-size:14px; opacity:0.9;">${user.job_title}</div>
                                    <div style="margin-top:5px;">${statusBadge}</div>
                                </div>
                            </div>
                            <div class="qr-container"><img src="${qrUrl}" class="qr-code"></div>
                        </div>

                        <div class="content">
                            <div class="stats-grid">
                                <div class="stat-card">
                                    <div class="stat-val">${user.leave_balance} يوم</div>
                                    <div class="stat-lbl">رصيد الإجازات</div>
                                </div>
                                <div class="stat-card">
                                    <div class="stat-val">${tasksCount}</div>
                                    <div class="stat-lbl">المهام المفتوحة</div>
                                </div>
                                <div class="stat-card">
                                    <div class="stat-val">0</div>
                                    <div class="stat-lbl">الغياب</div>
                                </div>
                                <div class="stat-card">
                                    <div class="stat-val">--</div>
                                    <div class="stat-lbl">آخر راتب</div>
                                </div>
                            </div>

                            <div class="info-grid">
                                <div class="info-box"><div class="label">القسم</div><div class="value">${user.department}</div></div>
                                <div class="info-box"><div class="label">تاريخ التعيين</div><div class="value">${user.hire_date || 'غير محدد'}</div></div>
                                <div class="info-box"><div class="label">وقت الدوام</div><div class="value">${user.start_time}</div></div>
                                <div class="info-box"><div class="label">البريد الإلكتروني</div><div class="value">${user.email}</div></div>
                            </div>

                            <h4 style="color:#003366; margin-bottom:10px; border-bottom:1px solid #eee; padding-bottom:10px;">الخدمات الذاتية</h4>
                            <div class="menu-grid">
                                ${attendanceBtn}
                                <button class="menu-btn">📝 طلب إجازة</button>
                                <button class="menu-btn">💰 كشف الراتب</button>
                            </div>

                            <div style="text-align:center; margin-top:30px;">
                                <a href="/logout" style="color:red; text-decoration:none;">تسجيل خروج</a>
                            </div>
                        </div>
                    </div>
                </body>
                </html>
            `);
        });
    });
});

// Admin Routes & API
app.get('/api/admin/data', (req, res) => { if (req.session.user?.role === 'admin') db.all(`SELECT * FROM users`, [], (e, u) => db.all(`SELECT * FROM logs ORDER BY id DESC LIMIT 50`, [], (e, l) => res.json({ users: u, logs: l }))); else res.status(403).json({}); });
app.post('/admin/delete', (req, res) => { if (req.session.user?.role === 'admin') db.run(`DELETE FROM users WHERE id = ?`, [req.body.id], () => res.redirect('/admin.html')); });
app.post('/admin/toggle-role', (req, res) => { if (req.session.user?.role === 'admin') db.get(`SELECT role FROM users WHERE id = ?`, [req.body.id], (e, u) => db.run(`UPDATE users SET role = ? WHERE id = ?`, [u.role === 'admin' ? 'employee' : 'admin', req.body.id], () => res.redirect('/admin.html'))); });
app.get('/admin.html', (req, res) => { if (req.session.user?.role === 'admin') res.sendFile(path.join(__dirname, 'public/admin.html')); else res.redirect('/login.html'); });
app.get('/logout', (req, res) => { req.session.destroy(() => res.redirect('/login.html')); });

const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => {
    console.log(`Server is running on port ${port}`);
});
