// generate-static-pages.js
// -----------------------------------------------------------------------------
// สคริปต์นี้ทำ 2 อย่าง เพื่อช่วยให้ Google เจอ "แต่ละประกาศ" แยกกันในผลค้นหา:
//
//   1) สร้างไฟล์ /ad/<id>/index.html สำหรับทุกประกาศที่ยังไม่หมดอายุ/ไม่ถูกปิด
//      - หน้านี้มี title/description/เนื้อหาจริงของประกาศ "อยู่ในไฟล์ HTML ตรงๆ"
//        (ไม่ต้องรอ JavaScript โหลดข้อมูลจาก Firestore ก่อน) ทำให้ Google
//        อ่านเนื้อหาได้ทันทีตอน crawl แม่นยำกว่าเดิมมาก
//      - พอมนุษย์เปิดหน้านี้ จะถูก redirect ต่อไปยังเว็บแอปตัวจริงอัตโนมัติ
//        (?view=...) เพื่อได้ประสบการณ์ใช้งานแบบ SPA เหมือนเดิมทุกอย่าง
//
//   2) สร้าง /sitemap.xml ที่รวมลิงก์หน้าแรก + ลิงก์ของทุกประกาศที่ยังไม่หมดอายุ
//      อัตโนมัติ ให้ Google Search Console ใช้เป็นแผนที่หาว่ามีประกาศอะไรบ้าง
//
// สคริปต์นี้ถูกเรียกใช้อัตโนมัติทุกวันผ่าน GitHub Actions
// (ดูไฟล์ .github/workflows/generate-seo-pages.yml)
// -----------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, query, where, getDocs } = require('firebase/firestore');

// 🔑 ค่านี้เหมือนกับ firebaseConfig ที่อยู่ใน index.html เป๊ะๆ
// (เป็นค่า public อยู่แล้วในเว็บไซต์ตัวเอง ไม่ใช่ความลับ ไม่ต้องเก็บเป็น secret ก็ได้
//  แต่ถ้าอยากเปลี่ยนทีหลังโดยไม่ต้องแก้โค้ด ใส่เป็น GitHub Actions secret แล้วอ่านผ่าน
//  process.env ตามด้านล่างนี้ก็ได้เหมือนกัน)
const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY || "AIzaSyCURMQSPIIuviXufNcAWgIcCv65JeqxpKI",
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || "chirasin-market.firebaseapp.com",
    projectId: process.env.FIREBASE_PROJECT_ID || "chirasin-market",
};

const SITE_URL = 'https://chirasin99.github.io';
const OUTPUT_ROOT = path.join(__dirname, '..'); // รากของ repo (ไฟล์นี้อยู่ใน scripts/ ก็เลยถอยออกมา 1 ชั้น

function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}

function escapeXml(str) {
    return String(str || '').replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}

// ไอดีประกาศจริงคือ "ads:1783748234662-fgcsI0" (มี : อยู่ในนั้น)
// เอามาใช้เป็นชื่อโฟลเดอร์/URL ตรงๆ ไม่สวยและอาจมีปัญหา เลยตัด "ads:" ออก เหลือแค่ "1783748234662-fgcsI0"
function idToSlug(id) {
    return id.replace(/^ads:/, '');
}

async function main() {
    console.log('🔥 กำลังเชื่อมต่อ Firestore...');
    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);

    // ดึงทุก doc ที่ key ขึ้นต้นด้วย "ads:" (เทียบเท่ากับ chirasinDB.list('ads:', true) ในเว็บ)
    const kvRef = collection(db, 'kv');
    const q = query(kvRef, where('key', '>=', 'ads:'), where('key', '<', 'ads:\uf8ff'));
    const snap = await getDocs(q);

    const now = Date.now();
    const activeAds = [];
    snap.forEach(function (doc) {
        var data = doc.data();
        var ad;
        try { ad = JSON.parse(data.value); } catch (e) { return; }
        if (!ad || !ad.id) return;
        if (ad.closed) return;
        if ((ad.promotionExpiresAt || 0) < now) return; // หมดอายุแล้ว ไม่เอามาสร้างหน้า/sitemap
        activeAds.push(ad);
    });

    console.log('📦 พบประกาศที่ยังแสดงอยู่ทั้งหมด ' + activeAds.length + ' รายการ');

    // ล้างโฟลเดอร์ /ad เก่าทิ้งก่อนสร้างใหม่ทั้งหมด (กันไฟล์ของประกาศที่หมดอายุ/ถูกลบไปแล้วค้างอยู่)
    var adDir = path.join(OUTPUT_ROOT, 'ad');
    if (fs.existsSync(adDir)) fs.rmSync(adDir, { recursive: true, force: true });
    fs.mkdirSync(adDir, { recursive: true });

    var sitemapEntries = [
        { loc: SITE_URL + '/', priority: '1.0' }
    ];

    activeAds.forEach(function (ad) {
        var slug = idToSlug(ad.id);
        var pageDir = path.join(adDir, slug);
        fs.mkdirSync(pageDir, { recursive: true });

        var title = escapeHtml(ad.title) + ' | CHIRASIN MARKET';
        var desc = escapeHtml((ad.desc || '').replace(/\s+/g, ' ').trim().slice(0, 155));
        var pageUrl = SITE_URL + '/ad/' + slug + '/';
        var redirectUrl = SITE_URL + '/?view=' + encodeURIComponent(ad.id);
        var img = (ad.images && ad.images[0] && ad.images[0].src) ? ad.images[0].src : (SITE_URL + '/cover.jpg');
        var priceText = ad.price ? ('฿ ' + escapeHtml(ad.price)) : '';

        var html = '<!DOCTYPE html>\n' +
            '<html lang="th">\n' +
            '<head>\n' +
            '<meta charset="UTF-8">\n' +
            '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
            '<title>' + title + '</title>\n' +
            '<meta name="description" content="' + desc + '">\n' +
            '<meta name="robots" content="index, follow">\n' +
            '<link rel="canonical" href="' + pageUrl + '">\n' +
            '<meta property="og:type" content="product">\n' +
            '<meta property="og:url" content="' + pageUrl + '">\n' +
            '<meta property="og:title" content="' + title + '">\n' +
            '<meta property="og:description" content="' + desc + '">\n' +
            '<meta property="og:image" content="' + escapeHtml(img) + '">\n' +
            '<meta property="og:site_name" content="CHIRASIN MARKET">\n' +
            '<meta property="og:locale" content="th_TH">\n' +
            // ⏩ redirect มนุษย์ไปหน้าเว็บแอปตัวจริงทันที (Googlebot จะยังอ่านเนื้อหาด้านล่างได้ก่อน redirect ทำงาน)
            '<meta http-equiv="refresh" content="0; url=' + redirectUrl + '">\n' +
            '<script>location.replace(' + JSON.stringify(redirectUrl) + ');</script>\n' +
            '<script type="application/ld+json">\n' +
            JSON.stringify({
                '@context': 'https://schema.org/',
                '@type': 'Product',
                name: ad.title,
                description: ad.desc,
                image: img,
                offers: {
                    '@type': 'Offer',
                    price: ad.price || undefined,
                    priceCurrency: 'THB',
                    availability: 'https://schema.org/InStock'
                }
            }, null, 2).replace(/<\/script/gi, '<\\/script') + '\n' +
            '</script>\n' +
            '</head>\n' +
            '<body>\n' +
            // 📄 เนื้อหาจริงแบบข้อความล้วน ให้ Google อ่านได้ทันทีไม่ต้องรอ JS
            '<h1>' + escapeHtml(ad.title) + '</h1>\n' +
            '<p>📍 ' + escapeHtml(ad.province) + (ad.district ? ' (' + escapeHtml(ad.district) + ')' : '') + (ad.category ? ' · ' + escapeHtml(ad.category) : '') + '</p>\n' +
            (priceText ? '<p><strong>' + priceText + '</strong></p>\n' : '') +
            '<p>' + escapeHtml(ad.desc) + '</p>\n' +
            '<p>กำลังพาไปหน้าประกาศ... ถ้าหน้าไม่เปลี่ยนอัตโนมัติ <a href="' + redirectUrl + '">กดที่นี่</a></p>\n' +
            '</body>\n' +
            '</html>\n';

        fs.writeFileSync(path.join(pageDir, 'index.html'), html, 'utf8');
        sitemapEntries.push({ loc: pageUrl, priority: '0.8' });
    });

    console.log('✅ สร้างหน้า static ทั้งหมด ' + activeAds.length + ' หน้า ในโฟลเดอร์ /ad/');

    // ---- สร้าง sitemap.xml ----
    var urlsXml = sitemapEntries.map(function (entry) {
        return '  <url>\n    <loc>' + escapeXml(entry.loc) + '</loc>\n    <priority>' + entry.priority + '</priority>\n  </url>';
    }).join('\n');
    var sitemapXml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        urlsXml + '\n' +
        '</urlset>\n';
    fs.writeFileSync(path.join(OUTPUT_ROOT, 'sitemap.xml'), sitemapXml, 'utf8');
    console.log('✅ สร้าง sitemap.xml เรียบร้อย รวม ' + sitemapEntries.length + ' ลิงก์');
}

main().catch(function (err) {
    console.error('❌ เกิดข้อผิดพลาด:', err);
    process.exit(1);
});
