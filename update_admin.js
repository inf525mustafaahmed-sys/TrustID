const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// الاتصال بقاعدة البيانات
const dbPath = path.join(__dirname, 'trustid.db');
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, (err) => {
    if (err) {
        console.error('❌ خطأ في الاتصال بقاعدة البيانات:', err.message);
        return;
    }
    console.log('✅ تم الاتصال بقاعدة البيانات لتعديل الصلاحيات...');
});

// 🔥 ضع إيميلك هنا بدلاً من هذا الإيميل
const myEmail = 'mustfajta@gmail.com'; 

// تنفيذ أمر التحديث
const sql = `UPDATE users SET role = 'admin' WHERE email = ?`;

db.run(sql, [myEmail], function(err) {
    if (err) {
        return console.error('❌ حدث خطأ أثناء التحديث:', err.message);
    }
    
    if (this.changes > 0) {
        console.log(`🎉 تم بنجاح! المستخدم صاحب الإيميل: ${myEmail}`);
        console.log(`👑 أصبح الآن مديراً (Admin) بشكل دائم.`);
    } else {
        console.log(`⚠️ لم يتم العثور على المستخدم: ${myEmail}`);
        console.log('تأكد أنك كتبت الإيميل بشكل صحيح كما سجلت به.');
    }
});

// إغلاق الاتصال
db.close();