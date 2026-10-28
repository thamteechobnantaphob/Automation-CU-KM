# คำสั่งรันเทส (Cheat sheet)

คัดลอกไปวางใน **PowerShell** ที่โฟลเดอร์โปรเจกต์ (`C:\ZNC\Automation_Test\KM-Nurs`) ได้เลย

> ก่อนรันครั้งแรกในเครื่องใหม่: `npm install` แล้ว `npx playwright install chromium` และกรอก `.env` (ดู README หัวข้อ 3)

---

## 1. รันตามโมดูล

| ต้องการรัน | คำสั่ง | สร้างข้อมูลบน Dev? |
|---|---|---|
| ทุกอย่าง | `npm test` | เฉพาะเมื่อเปิด `ALLOW_DATA_CREATING_TESTS` |
| KM-AUTH (login/logout/session) | `npm run test:auth` | ไม่ |
| หน้า Public (KM-FEH/FEC/FEK/FEN) | `npm run test:public` | ไม่ (อ่านอย่างเดียว ไม่ต้อง login) |
| KM-FUSR (ฟอร์มเพิ่ม/แก้ไขผู้ใช้) | `npm run test:fusr` | **ใช่** ถ้าเปิดสวิตช์ (ดูหัวข้อ 4) |
| KM-ADMR/KM-FROL (สิทธิ์การใช้งาน) | `npm run test:roles` | **ใช่** ถ้าเปิดสวิตช์ (สร้างสิทธิ์ `[Auto Test]` และผู้ใช้ `qa_auto_` — ล้างด้วย `npm run cleanup:data`) |
| KM-ADML (ประวัติการใช้งานระบบ) | `npm run test:activity-log` | ไม่ (อ่านอย่างเดียว; การ login ในบางเคสเพิ่มแถว login ใน log เท่านั้น) |
| KM-NFR (ข้อกำหนดที่ไม่ใช่ฟังก์ชัน ทั้งระบบ) | `npm run test:nfr` | ไม่ (อ่านอย่างเดียว; เคสที่ออกจากระบบใช้ session แยก; เกณฑ์ TTFB 500 ms/1 s และน้ำหนักหน้า 3 MB แก้ที่ค่าคงที่ต้น `tests/nfr/performance.spec.ts`) |
| KM-ADMD (แดชบอร์ด) | `npm run test:dashboard` | ไม่ (อ่านอย่างเดียว; 7 เคสตัวกรองเป็น known bug DEF-33) |
| KM-ADMG (หมวดหมู่) | `npm run test:categories` | **ใช่** ถ้าเปิดสวิตช์ (สร้างหมวดหมู่แท็บ "คลังความรู้" — ล้างด้วย `npm run cleanup:categories`); 01-01, 02-02, 03-10 ไม่สร้างข้อมูล |
| KM-SEC (ความปลอดภัยทั้งระบบ) | `npm run test:security` | 15 เคสอ่านอย่างเดียว; **4 เคส (SEC-01-01/05/08, SEC-03-03) สร้างผู้ใช้/สิทธิ์** และส่วนหลังของ SEC-03-06 จะทำงานเมื่อเปิดสวิตช์ — ล้างด้วย `npm run cleanup:data` |
| KM-ADMU (หน้าจัดการผู้ใช้งานระบบ) | `npm run test:admu` | **ใช่ และมีการลบ** ถ้าเปิดสวิตช์ (ลบเฉพาะผู้ใช้ `qa_auto_` ที่เทสสร้างเอง) |

### แยกเป็นกลุ่มย่อย

```powershell
# KM-AUTH
npx playwright test tests/auth/login.spec.ts
npx playwright test tests/auth/session-security.spec.ts

# KM-FUSR
npx playwright test tests/admin/user-management/user-form-modal.spec.ts                       # SC-FUSR-01 เปิด/ปิด modal
npx playwright test tests/admin/user-management/user-form-username-validation.spec.ts         # SC-FUSR-02 username
npx playwright test tests/admin/user-management/user-form-name-validation.spec.ts             # SC-FUSR-03 ชื่อ-นามสกุล
npx playwright test tests/admin/user-management/user-form-email-validation.spec.ts            # SC-FUSR-04 อีเมล
npx playwright test tests/admin/user-management/user-form-department-position-validation.spec.ts   # SC-FUSR-05 หน่วยงาน/ตำแหน่ง

# KM-ADMU
npx playwright test tests/admin/user-list/user-list.spec.ts             # SC-ADMU-01/02/03/08 รายการ, เพิ่ม, ลบ, สิทธิ์, แก้ไขอีเมลซ้ำ
npx playwright test tests/admin/user-list/user-name-username.spec.ts     # SC-ADMU-04 ชื่อ-สกุล, SC-ADMU-05 username
npx playwright test tests/admin/user-list/user-email.spec.ts             # SC-ADMU-06 อีเมล
npx playwright test tests/admin/user-list/user-password.spec.ts          # SC-ADMU-07 รหัสผ่าน

# KM-ADMR / KM-FROL
npx playwright test tests/admin/roles/role-list-and-form.spec.ts            # อ่านอย่างเดียว: รายการสิทธิ์ + เปิดฟอร์ม (ADMR-01, FROL-01)
npx playwright test tests/admin/roles/role-name-description.spec.ts        # FROL-02 / ADMR-04 ชื่อและคำอธิบายสิทธิ์ (สร้างสิทธิ์)
npx playwright test tests/admin/roles/role-save-and-edit.spec.ts           # FROL-05 บันทึก/แก้ไข/กดซ้ำ + ADMR-02 ชื่อว่าง/ชื่อซ้ำ (สร้างสิทธิ์)
npx playwright test tests/admin/roles/role-user-assignment.spec.ts         # FROL-05-04 / ADMR-05-07 จำนวนผู้ใช้ของสิทธิ์ (สร้างสิทธิ์ + ผู้ใช้)
npx playwright test tests/admin/roles/role-security.spec.ts                # FROL-06 ความปลอดภัยของหน้าสิทธิ์ (สร้างผู้ใช้จำกัดสิทธิ์ + สิทธิ์ทดสอบ)

# KM-AUTH (เคสที่เหลือ)
npx playwright test tests/auth/login-extra.spec.ts   # AUTH-01-03, 04-01/02, 05-03/06/07 (อ่านอย่างเดียว; ทุกเคสที่ออกจากระบบใช้ session แยก)

# KM-NFR
npx playwright test tests/nfr/consistency.spec.ts   # ลิงก์ทั้งระบบ, รูปแบบวันที่, หน้า 404/405, การสะกด ปฏิบัติ, ชื่อเมนู/ปุ่ม
npx playwright test tests/nfr/ui-behaviour.spec.ts   # loader, ยุบ/ขยาย sidebar, เมนูที่ไฮไลต์, ปุ่มหน้าเว็บไซต์, ออกจากระบบ 2 จุด
npx playwright test tests/nfr/compatibility.spec.ts  # responsive 4 ขนาด, axe accessibility, แท็บเล็ต, ปิด JavaScript, เขตเวลา
npx playwright test tests/nfr/performance.spec.ts    # TTFB, น้ำหนักหน้า, cache/gzip
npx playwright test tests/nfr/csrf-basics.spec.ts    # CSRF แบบอ่านอย่างเดียว (419 ทุกจุด ไม่แตะข้อมูล)

# KM-ADML / KM-ADMD
npx playwright test tests/admin/activity-log/activity-log.spec.ts   # ADML ตัวกรอง/แบ่งหน้า/เขตเวลา/ปฏิเสธการแก้ไข-ลบ (อ่านอย่างเดียว)
npx playwright test tests/admin/dashboard/dashboard.spec.ts         # ADMD แท็บ/ตัวเลข/responsive + ตัวกรอง (อ่านอย่างเดียว)

# KM-ADMG
npx playwright test tests/admin/categories/category-tabs.spec.ts   # ADMG-01 แท็บประเภทหมวดหมู่ (อ่านอย่างเดียว)
npx playwright test tests/admin/categories/category-name.spec.ts   # ADMG-02/03 ตรวจชื่อหมวดหมู่ (สร้างหมวดหมู่)

# KM-SEC
npx playwright test tests/security/injection.spec.ts             # SEC-01 XSS/SQL/CRLF ผ่านพารามิเตอร์ URL (ใช้เวลา ~1.5 นาที)
npx playwright test tests/security/exposure.spec.ts              # SEC-02 directory listing, ไฟล์สำคัญ, debug, source map, robots, path traversal
npx playwright test tests/security/browser-protections.spec.ts   # SEC-03/04 clickjacking, CORS, verb tampering, security headers, อีเมลรั่วบน Public
npx playwright test tests/security/stored-injection.spec.ts       # SEC-01-01/05/08 payload ที่ถูกเก็บ (สร้างผู้ใช้ + สิทธิ์ ต่อเคส)
npx playwright test tests/security/csrf-all-actions.spec.ts       # SEC-03-03 CSRF ทุก action (สร้างสิทธิ์ + ผู้ใช้ของตัวเอง)

# หน้า Public
npx playwright test tests/public/site-chrome.spec.ts       # เมนู, footer, Back to Top, คีย์บอร์ด, มือถือ
npx playwright test tests/public/home-content.spec.ts      # carousel ชุมชน, empty state หน้าหลัก
npx playwright test tests/public/public-access.spec.ts     # เข้าถึงโดยไม่ login, title/lang/favicon, console error
npx playwright test tests/public/url-handling.spec.ts      # URL ผิดรูปแบบ, ?page, path traversal
npx playwright test tests/public/cops.spec.ts              # หน้าชุมชนนักปฏิบัติ
npx playwright test tests/public/content-lists.spec.ts     # คลังความรู้, Best Practice, ข่าว, คลังกิจกรรม
```

## 2. รันเคสเดียว / หลายเคส (`-g` = กรองตามชื่อ)

```powershell
npx playwright test -g "TC-FEH-01-05"                        # เคสเดียว
npx playwright test -g "TC-FUSR-02"                          # ทุกเคสที่ขึ้นต้นด้วย TC-FUSR-02
npx playwright test -g "TC-FUSR-02-12|TC-FUSR-04-12"         # หลายเคส (คั่นด้วย | ต้องอยู่ในเครื่องหมายคำพูด)
npx playwright test tests/public -g "TC-FEH-03"              # ผสมโฟลเดอร์กับชื่อ
npx playwright test --last-failed                            # รันเฉพาะเคสที่ล้มในรอบก่อน
```

## 3. ดูการทำงาน / debug

```powershell
npm run test:headed                                # เห็นเบราว์เซอร์จริง (ใช้ร่วมกับ path/-g ได้: npx playwright test tests/auth --headed)
npm run test:ui                                    # Playwright UI mode (เลือกเคสกด run ดู timeline ได้)
npx playwright test -g "TC-FEH-01-05" --debug      # หยุดทีละขั้นด้วย Inspector
npm run test:list                                  # แสดงรายการเทสทั้งหมดโดยไม่รัน
```

## 4. เคสที่สร้างข้อมูลจริงบน Dev (KM-FUSR)

เคสที่กด "บันทึก" สร้างผู้ใช้จริง (ชื่อ/หน่วยงานมี `[Auto Test]`, username ขึ้นต้น `qa_auto_`) จึงถูก **skip** ไว้เป็นค่าเริ่มต้น เปิดเฉพาะรอบที่ต้องการโดยไม่ต้องแก้ `.env`:

```powershell
$env:ALLOW_DATA_CREATING_TESTS = 'true'
npm run test:fusr        # หรือ npm run test:admu / npm run test:roles
Remove-Item Env:ALLOW_DATA_CREATING_TESTS          # ปิดสวิตช์คืนหลังรันเสร็จ
```

รันเฉพาะเคสที่ไม่สร้างข้อมูลได้เลย (ไม่ต้องตั้งอะไร) — เคสที่ต้องสร้างข้อมูลจะขึ้น "skipped" พร้อมเหตุผล

## 5. รันแล้วเก็บหลักฐาน (Evidence) ทุกเคส

ใส่ `--` คั่นก่อนอาร์กิวเมนต์เสมอ:

```powershell
npm run test:evidence                                    # ทั้งหมด
npm run test:evidence -- tests/public                    # เฉพาะหน้า Public
npm run test:evidence -- tests/auth
npm run test:evidence -- tests/admin/user-management/user-form-email-validation.spec.ts
npm run test:evidence -- -g "TC-FUSR-02-12|TC-FUSR-01-07"
```

ผลอยู่ที่ `evidence\<วัน_เวลา>\` (เปิด `summary.md` ก่อน) — สร้างใหม่ทุกรอบ ไม่เขียนทับ ย้ายหรือลบทิ้งได้
มี `screenshots\` / `videos\` ตั้งชื่อตาม Test Case ID และ `results.csv`

### Test ใหม่ / Continue Test (รอบทดสอบ)

```powershell
npm run test:new                              # Test ใหม่: ลบ evidence เก่าทั้งหมด แล้วรันทั้งชุดตั้งแต่ต้น
npm run test:new -- tests/auth                # ...หรือเริ่มรอบใหม่ด้วยบางส่วน
npm run test:continue                         # Continue: รันเฉพาะเคสที่รอบนี้ยังไม่มีผล (รันค้าง / spec ใหม่ / เคสที่เคย skip)
npm run test:continue -- --retry-failed       # ...และรันเคสที่ไม่ผ่านซ้ำด้วย
$env:ALLOW_DATA_CREATING_TESTS='true'; npm run test:continue   # ต่อด้วยเคสที่สร้างข้อมูล (ที่รอบแรก skip ไว้)
npm run test:round                            # ดูผลรวมของรอบ ไม่รันอะไร
```

ผลรวมของทั้งรอบ (เอาผลล่าสุดของแต่ละเคส) อยู่ที่ `evidence\round-summary.md` และ `evidence\round-results.csv`
`test:new` ลบเฉพาะโฟลเดอร์รัน `evidence\<วัน_เวลา>\` — ไฟล์ `cleanup-*.md` (บันทึกการลบข้อมูลทดสอบ) ยังเก็บไว้

## 6. ดูรายงาน / ตรวจโค้ด / อัปเดตรายการเคส

```powershell
npm run report                 # เปิด HTML report ล่าสุด (http://localhost:9323)
npm run typecheck              # ตรวจ TypeScript
npm run generate:all           # หลังแก้ scripts/implemented-cases.json: สร้าง tests/pending + TRACEABILITY.md ใหม่
```

## 7. ล้างข้อมูลทดสอบบน Dev (ผู้ใช้ + สิทธิ์การใช้งาน)

```powershell
npm run cleanup:data                          # ดูรายการเฉย ๆ (dry run) ไม่ลบอะไร — เปิดดูก่อนเสมอ
npm run cleanup:data -- --delete --limit 1   # ลบจริงแค่ 1 รายการ (ลองก่อน)
npm run cleanup:data -- --delete             # ลบทุกรายการที่อยู่ในกลุ่ม "ลบ" (ผู้ใช้ก่อน แล้วค่อยสิทธิ์)
npm run cleanup:users                        # เฉพาะผู้ใช้ (dry run)   — ใส่ -- --delete เพื่อลบจริง
npm run cleanup:roles                        # เฉพาะสิทธิ์ (dry run)   — ใส่ -- --delete เพื่อลบจริง
npm run cleanup:categories                   # เฉพาะหมวดหมู่ (dry run) — ใส่ -- --delete เพื่อลบจริง
npm run cleanup:data -- --delete --include "ADMIN"                 # ลบผู้ใช้ที่สคริปต์ให้ "ตรวจสอบเอง" (ชื่อเป๊ะ ๆ)
npm run cleanup:data -- --delete --include-role "ชื่อสิทธิ์เป๊ะ ๆ"   # ลบสิทธิ์ที่ไม่มี [Auto Test] แต่อยากลบ
```

- ผู้ใช้: ลบเฉพาะ username ที่ automation สร้าง (`qa_auto_…`, `QA_AUTO_…`, และ `ทดสอบ<stamp>` ที่ชื่อมี `[Auto Test]`) ไม่แตะ `admin` และผู้ใช้จริง
- หมวดหมู่: ลบเฉพาะการ์ดที่มี `[Auto Test]` ในชื่อหรือ "หัวข้อย่อย" (ตรวจทั้ง 6 แท็บ) — `AUTO_CAT_001` ของ QA ไม่ถูกแตะ
- สิทธิ์: ลบเฉพาะแถวที่มีปุ่มลบ + ชื่อหรือคำอธิบายมี `[Auto Test]` + จำนวนผู้ใช้ = 0 — สิทธิ์ของระบบ (`ผู้ดูแลระบบ`, `บุคลากรที่ได้รับมอบหมาย`) และ `ตรวจสอบข้อมูลระบบ` ของ QA จะไม่ถูกแตะ
- มี log ที่ `evidence\cleanup-<วัน_เวลา>.md`

---

## อ่านผลลัพธ์ให้ถูก

- `ok` = ผ่าน, `x` ในรายการ = **Known bug** (เคสที่ตั้ง `test.fail` เพราะแอปมีบั๊กจริง) Playwright จะนับว่า "passed" เพราะล้มตามที่คาดไว้ — ดูตัวเลขที่แยกประเภทจริงใน `evidence\...\summary.md`
- ถ้า Known bug กลายเป็น **"ผ่านโดยไม่คาดคิด"** แปลว่า dev แก้แล้ว ให้ถอด `test.fail` ออกจากเคสนั้น
- **PowerShell แสดงข้อความสีแดง `NativeCommandError` ที่บรรทัด `◇ injected env` ได้** — เป็นแค่ PowerShell 5.1 มองข้อความของ dotenv เป็น error ไม่มีผลต่อการรัน ดูผลที่บรรทัดสรุปท้ายสุด

## ข้อควรระวัง

- เทสรันทีละตัวโดยตั้งใจ (`workers: 1`) เพราะใช้ระบบ/ข้อมูลชุดเดียวกัน อย่าเพิ่ม `--workers` เอง
- เทสหน้า Public ต้องออกอินเทอร์เน็ตได้ (เว็บโหลด Owl Carousel / Font Awesome จาก cdnjs) ไม่งั้นเคส carousel ล้มโดยไม่ใช่บั๊กของแอป
- อย่ารัน `test:fusr` / `test:admu` แบบเปิดสวิตช์ซ้ำโดยไม่จำเป็น — ทุกรอบเพิ่มผู้ใช้ทดสอบบน Dev (ล้างได้ด้วยหัวข้อ 7)
- Evidence ของหน้า admin (เช่น รายชื่อผู้ใช้) มีอีเมลจริงอยู่ในภาพ
