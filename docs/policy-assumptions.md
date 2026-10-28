# ค่านโยบายที่ใช้ทดสอบ (รอ SA/Dev ยืนยัน)

ตกลงกับ QA เมื่อ 2026-10-07: เคสที่ชีตเขียนเป็น `{MAX}` / `{MIN}` / TBD ใช้ค่าข้างล่างนี้ไปก่อน ค่าทั้งหมดอยู่ที่
`src/config/policy.ts` — ถ้า SA กำหนดค่าอื่น แก้ที่ไฟล์นั้นจุดเดียว แล้วรันเคสที่เกี่ยวข้องใหม่

## ความยาวข้อความ (OWASP Input Validation: ทุกช่องต้องกำหนดความยาวและตรวจฝั่ง server — OWASP ไม่กำหนดตัวเลข)

| ช่อง | ค่าที่ใช้ |
|---|---|
| Username | 3–50 ตัว |
| ชื่อ-นามสกุล, ชื่อผู้ติดต่อ, ชื่อผู้แต่ง, ชื่อหมวดหมู่, ชื่อสิทธิ์, ชื่อลิ้งค์ Footer | ≤ 100 |
| หน่วยงาน, ตำแหน่ง, แหล่งที่มา, ชื่อชุมชน | ≤ 150 |
| หัวเรื่อง, ชื่ออัลบัม | ≤ 255 |
| รายละเอียดย่อ, คำอธิบาย, คำถาม FAQ, ที่อยู่ | ≤ 500 |
| ข้อความติดต่อ | ≤ 5,000 |
| คำตอบ FAQ | ≤ 10,000 |
| อีเมล | ≤ 254 (RFC 5321) |
| URL | ≤ 2,048 |

ทุกช่อง: ตรวจฝั่ง server, ตัดช่องว่างหน้า-หลัง, ข้อความแจ้งภาษาไทย (ไม่ใช่ key ดิบ), เกินแล้วไม่เกิด 500

## ไฟล์อัปโหลด (OWASP File Upload Cheat Sheet, ASVS 4.0.3 V12)

- เอกสาร pdf/doc/docx/xls/xlsx/ppt/pptx ≤ 10 MB/ไฟล์, ≤ 10 ไฟล์/รายการ (ASVS 12.1.3)
- รูป jpg/png ≤ 5 MB/รูป, อัลบัมอัปโหลดครั้งละ ≤ 20 รูป; เข้ารหัสรูปใหม่และตัด metadata ("rewrite images")
- วิดีโอ mp4/webm (mov/avi/mkv ตามที่ระบบรับ) ≤ 50 MB/ไฟล์
- ขนาดคำขอรวม ≤ 60 MB และต้องปฏิเสธเร็วพร้อมข้อความ
- ตรวจชนิดจากเนื้อหา (ASVS 12.2.1), ปฏิเสธไฟล์ 0 ไบต์/ไฟล์เสีย
- ตั้งชื่อไฟล์ใหม่ฝั่ง server, ชื่อที่แสดง ≤ 255 ตัว, ไม่ใช้ path จากผู้ใช้ (ASVS 12.3.1–12.3.2)
- เก็บนอก webroot / เสิร์ฟผ่าน handler, ไม่ execute (ASVS 12.4.1, 12.5.2)

## Session / brute force / log / export

- Idle timeout 30 นาที, absolute ≤ 12 ชั่วโมง (ASVS 3.3.2 L2; Session Management Cheat Sheet 15–30 นาที, 4–8 ชม.)
- Login ผิด 5 ครั้งใน 15 นาที (ต่อบัญชี + IP) → หน่วง/CAPTCHA; ไม่เกิน 100 ครั้ง/ชม. (ASVS 2.2.1); ข้อความกลาง
- ฟอร์มติดต่อ ≤ 5 ครั้ง/10 นาที/IP (มี 429 อยู่แล้ว)
- Log: login สำเร็จ/ไม่สำเร็จ, logout, 403, เพิ่ม/แก้/ลบ ผู้ใช้/สิทธิ์/เนื้อหา/หมวดหมู่/ชุมชน; เวลาไทย ผู้ใช้ การกระทำ รายการ IP (Logging Cheat Sheet)
- Export CSV/Excel: เซลล์ขึ้นต้น `= + - @` tab CR LF เติม `'` นำหน้า, UTF-8 BOM (OWASP CSV Injection)
- เนื้อหา HTML: sanitize แบบ allowlist ฝั่ง server, ลิงก์เฉพาะ http/https/mailto, iframe เฉพาะ YouTube + sandbox/allow (XSS Prevention Cheat Sheet)

## เคสที่ไม่ทำตอนนี้ (scripts/deferred-cases.json)

- รหัสผ่าน 22 เคส: ยกเลิกไปก่อน (ระบบใช้ LDAP) — หาวิธีทดสอบบน server จุฬาตอนขึ้น UAT
- ต้องใช้บัญชี CU NET ที่ไม่ใช่ admin 60 เคส: On hold รอ UAT
- Auto: M 34 เคส: QA ทดสอบเองรอบสุดท้าย

## แหล่งอ้างอิง

- https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Denial_of_Service_Cheat_Sheet.html
- https://community.owasp.org/attacks/CSV_Injection
- OWASP ASVS 4.0.3 — V2 Authentication, V3 Session Management, V12 Files and Resources
