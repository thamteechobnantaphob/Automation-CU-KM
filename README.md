# KM-Portal (CU-Nurse) — Test Automation

Playwright + TypeScript automation สำหรับ KM-Portal CU-Nurse โดยอ้างอิงจากไฟล์ Test Case:

- `Test_Case_KM-Portal_CU-Nurse_v2.xlsx`
- `Test_Case_KM-Portal_CU-Nurse_v2_Supplement_Forms.xlsx`

เฉพาะเคสที่คอลัมน์ **Remark(s)** ขึ้นต้นด้วย `Auto: Y` เท่านั้น (รวม **760 เคส** จาก 33 โมดูล) — ดูสถานะทั้งหมดใน [TRACEABILITY.md](./TRACEABILITY.md)

โครงสร้างนี้ถูกวางให้เป็น **แม่แบบมาตรฐาน** สำหรับโปรเจกต์ automation อื่น ๆ ในอนาคตด้วย (Page Object Model, config ผ่าน `.env`, fixtures, reporter, และ script สร้าง scaffold จาก Excel)

---

## 1. สถานะปัจจุบัน (Phase 1)

จาก 760 เคส Auto:Y ทำงานนี้เลือกทำแบบ **เฟส** ตามที่ตกลงกันไว้ เพื่อไม่ให้เขียนเทสจำนวนมากโดยยังไม่เห็นหน้าจอจริง:

| สถานะ | จำนวน | รายละเอียด |
|---|---:|---|
| **Implemented** (โค้ดจริง รันได้) | 246 เคส | KM-AUTH (28/28) + KM-ADML (10/10) + KM-ADMD (11/11) + KM-NFR (21/28) + KM-FUSR (45/81) + KM-ADMU (36/44) + KM-ADMR (9/11) + KM-FROL (28/32) + KM-ADMG (11/13) + KM-SEC (19/19) + หน้า Public: KM-FEH (19/19), KM-FEC (4/4), KM-FEK (2/5), KM-FEN (3/4) |
| **Pending** (scaffold ด้วย `test.fixme`) | 514 เคส | ทุกโมดูลที่เหลือ ครบทุก Test Case ID |

- **Implemented** = เขียนเป็น Playwright test จริง มี assertion ที่ตรวจสอบได้จริง อยู่ใน `tests/auth/`, `tests/admin/user-management/`, `tests/admin/user-list/`, `tests/admin/roles/`, `tests/admin/categories/`, `tests/admin/activity-log/`, `tests/admin/dashboard/`, `tests/nfr/`, `tests/security/` และ `tests/public/`
- **Pending** = สร้างไว้ล่วงหน้าใน `tests/pending/<module>.pending.spec.ts` ด้วยข้อมูลครบ (Test Script, Expected Result, Priority) แต่ยังไม่ implement จริง (`test.fixme`) เพราะยังไม่มี locator ที่ยืนยันจากหน้าจอจริง หรือ Expected Result ยังเป็น `(TBD)` ในไฟล์ Excel ต้นฉบับ

รัน `npx playwright test --list` เพื่อดูเทสทั้งหมด (pending จะไม่ถูกรันจริง แต่จะขึ้นในรายงานว่า "fixme")

---

## 2. โครงสร้างโปรเจกต์

```
├─ src/
│  ├─ config/env.ts          # โหลดและตรวจสอบค่าใน .env
│  ├─ pages/                 # Page Object Model
│  │  ├─ BasePage.ts
│  │  ├─ LoginPage.ts
│  │  ├─ DashboardPage.ts
│  │  ├─ admin/
│  │  │  ├─ AdminUserListPage.ts
│  │  │  └─ AdminUserFormModal.ts
│  │  └─ public/            # เมนู/footer/หน้าหลัก/หน้ารายการของเว็บสาธารณะ
│  │     ├─ PublicPage.ts
│  │     ├─ HomePage.ts
│  │     └─ ContentListPages.ts
│  ├─ fixtures/pages.fixtures.ts   # extend Playwright test ด้วย Page Object
│  └─ utils/                 # helper (string ยาว, username สุ่ม, ข้อมูลทดสอบ, ตาราง URL/เมนูของหน้า Public,
│                             #   PageDiagnostics ดัก console/HTTP error, rawHttp ส่ง path ดิบสำหรับเคส path traversal)
├─ tests/
│  ├─ auth/                  # KM-AUTH — implemented
│  ├─ admin/user-management/ # KM-FUSR (บางส่วน) — implemented
│  ├─ admin/roles/           # KM-ADMR/KM-FROL (รายการสิทธิ์ + ฟอร์มสิทธิ์) — implemented บางส่วน
│  ├─ admin/categories/      # KM-ADMG (หน้าจัดการหมวดหมู่: แท็บประเภท + ตรวจชื่อ) — implemented บางส่วน
│  ├─ admin/activity-log/    # KM-ADML (ประวัติการใช้งานระบบ: รายการ, ตัวกรอง, เขตเวลา) — implemented ครบ อ่านอย่างเดียว
│  ├─ admin/dashboard/       # KM-ADMD (แดชบอร์ด: แท็บ, ตัวเลข, responsive + ตัวกรองที่ยังไม่ทำงาน = known bug DEF-33) — implemented ครบ อ่านอย่างเดียว
│  ├─ nfr/                   # KM-NFR (ทั้งระบบ: ลิงก์, วันที่, error page, สะกดคำ, เมนู, responsive, accessibility, ประสิทธิภาพ, CSRF) — implemented 21/28 อ่านอย่างเดียว
│  ├─ admin/user-list/       # KM-ADMU (หน้าจัดการผู้ใช้: รายการ, เพิ่ม/ลบ/แก้ไข, ฟิลด์) — implemented
│  ├─ security/              # KM-SEC (ความปลอดภัยทั้งระบบ: injection/XSS, การเปิดเผยข้อมูล, header, CORS, CSRF) — ส่วนใหญ่อ่านอย่างเดียว
│  ├─ public/                # KM-FEH/FEC/FEK/FEN (หน้า Public, อ่านอย่างเดียว ไม่ต้อง login) — implemented
│  └─ pending/                # scaffold ของทุกโมดูลที่เหลือ (generated)
├─ scripts/
│  ├─ lib/extract-cases.js          # อ่าน Excel ทั้งสองไฟล์ (ใช้ร่วมกัน)
│  ├─ generate-pending-tests.js     # สร้าง tests/pending/*.pending.spec.ts
│  ├─ generate-traceability.js      # สร้าง TRACEABILITY.md + traceability.csv
│  ├─ implemented-cases.json        # รายชื่อ Test Case ID ที่ implement แล้ว
│  ├─ run-with-evidence.js          # รันเทส (เก็บภาพ+วิดีโอทุกเคส) แล้วเก็บ evidence
│  └─ archive-evidence.js           # จัดผลการรันเป็นโฟลเดอร์ evidence/<วันเวลา>/
├─ global-setup.ts            # login ครั้งเดียว เก็บ storageState ให้ทุกเทสใช้ร่วมกัน
├─ playwright.config.ts
├─ .env
├─ evidence/                  # (สร้างเมื่อรัน test:evidence — อยู่ใน .gitignore)
└─ TRACEABILITY.md / traceability.csv   # generated
```

---

## 3. การติดตั้ง

```powershell
npm install
npx playwright install chromium
```

จากนั้นสร้าง/ตั้งค่า `.env` ที่ราก โปรเจกต์:

```
BASE_URL=http://192.100.10.26:8081
ADMIN_USER=<ชื่อผู้ใช้ admin จริง>
ADMIN_PASS=<รหัสผ่าน admin จริง>
ALLOW_DATA_CREATING_TESTS=false
```

> **ไม่ได้ใส่ username/password จริงไว้ให้** ตามที่ตกลงกัน — กรอกเองในเครื่องของคุณ ไฟล์ `.env` อยู่ใน `.gitignore` แล้ว จะไม่ถูก commit

---

## 4. การรันเทส

```powershell
npm test                    # รันทั้งหมด (เทส pending จะขึ้น "fixme" ไม่ถูก execute)
npm run test:auth           # เฉพาะ KM-AUTH
npm run test:public         # เฉพาะหน้า Public (KM-FEH/FEC/FEK/FEN) — อ่านอย่างเดียว ไม่สร้างข้อมูล
npm run test:security       # KM-SEC (ความปลอดภัยทั้งระบบ) — ส่วนใหญ่อ่านอย่างเดียว; เคส stored-injection/CSRF/verb-tampering ส่วนหลังจะ skip ถ้ายังไม่เปิด ALLOW_DATA_CREATING_TESTS
npm run test:activity-log   # KM-ADML (ประวัติการใช้งานระบบ) — อ่านอย่างเดียว
npm run test:nfr            # KM-NFR (ข้อกำหนดที่ไม่ใช่ฟังก์ชันทั้งระบบ) — อ่านอย่างเดียว ~3 นาที (ต้องมี @axe-core/playwright: npm install)
npm run test:dashboard      # KM-ADMD (แดชบอร์ด) — อ่านอย่างเดียว
npm run test:categories     # KM-ADMG (หมวดหมู่) — เคสที่บันทึกหมวดหมู่จะ skip ถ้ายังไม่เปิด ALLOW_DATA_CREATING_TESTS (ล้างด้วย npm run cleanup:categories)
npm run test:roles          # KM-ADMR/KM-FROL (สิทธิ์การใช้งาน) — เคสที่สร้างสิทธิ์/ผู้ใช้จะ skip ถ้ายังไม่เปิด ALLOW_DATA_CREATING_TESTS (ล้างด้วย npm run cleanup:data)
npm run test:admu           # KM-ADMU — เคสที่สร้าง/ลบข้อมูลจะ skip ถ้ายังไม่เปิด ALLOW_DATA_CREATING_TESTS
npm run test:fusr           # KM-FUSR — เคสที่สร้างข้อมูลจะ skip ถ้ายังไม่เปิด ALLOW_DATA_CREATING_TESTS (สรุปคำสั่งทั้งหมด: RUN-TESTS.md)
npm run test:headed         # เห็นเบราว์เซอร์จริงระหว่างรัน
npm run test:ui             # Playwright UI mode (แนะนำตอนเขียน/debug เทสใหม่)
npm run test:list           # ดูรายการเทสทั้งหมดโดยไม่รัน
npm run report              # เปิด HTML report ล่าสุด
npm run typecheck           # ตรวจ TypeScript ทั้งโปรเจกต์
npm run test:evidence       # รัน + เก็บ evidence ทุกเคส (ดูหัวข้อ 9)
```

ก่อนรันเทสที่ต้อง login (เกือบทุกเทสยกเว้น `tests/auth/login.spec.ts`) ระบบจะ login ด้วย `ADMIN_USER`/`ADMIN_PASS` อัตโนมัติผ่าน `global-setup.ts` แล้วเก็บ session ไว้ที่ `playwright/.auth/admin.json` ให้ทุกเทสใช้ร่วมกัน (เร็วกว่า login ทุกเทส) — ถ้ายังไม่กรอก `.env` เทสที่ต้อง login จะ **skip** อัตโนมัติ พร้อมข้อความบอกสาเหตุ ไม่ error สับสน

เทสรันทีละตัว (`workers: 1`, `fullyParallel: false`) โดยตั้งใจ เพราะทุกเทสใช้ระบบและตารางข้อมูลชุดเดียวกัน ถ้ารันพร้อมกันหลายตัว เทสหนึ่งจะสร้างข้อมูลแทรกเข้ามาขณะอีกเทสกำลังนับ "ก่อน/หลัง" จนผลเพี้ยน (เจอจริงเมื่อ 2026-09-24)

**หน้ารายการผู้ใช้แบ่งหน้า (หน้าละ 20 แถว, `?page=N`)** เมื่อผู้ใช้เกิน 20 คนบัญชี `admin` จะย้ายไปหน้า 2 และแถวใหม่ที่เทสสร้างอาจอยู่หน้า 2 ด้วย จึงต้องใช้ตัวช่วยใน `AdminUserListPage` เสมอ: `userCount()` (อ่านยอดรวมจาก "จาก N รายการ"), `locateUser(username)` / `expectListed(username)` (ไล่หาทุกหน้า) — **อย่านับ `rows.count()` หรือใช้ `rowByUsername()` ตรง ๆ** เพราะเห็นแค่หน้าที่เปิดอยู่ (พบตอนตารางถึง 29 แถวเมื่อ 2026-09-25)

**เทสหน้า Public (`tests/public/`)** รันแบบ *ไม่ login* (`test.use({ storageState: ANONYMOUS_SESSION })` — ถ้าใช้ session admin เว็บจะแสดงผลต่างจากผู้เยี่ยมชมจริง) และอ่านอย่างเดียว ไม่สร้างข้อมูลบน Dev ข้อควรรู้:
- เครื่องที่รันต้องออกอินเทอร์เน็ตได้ เพราะเว็บโหลด Owl Carousel/Font Awesome จาก `cdnjs.cloudflare.com` (ถ้าออกเน็ตไม่ได้ เคส carousel จะล้ม ซึ่งเป็นปัญหาของสภาพแวดล้อม ไม่ใช่บั๊กของแอป)
- การ์ดซ้ำใน carousel หน้าหลักคือ clone ของ Owl (`.owl-item.cloned`) ไม่ใช่ข้อมูลซ้ำ — นับเฉพาะ `:not(.cloned)`
- URL รายละเอียดชุมชนเป็น token เข้ารหัสที่เปลี่ยนทุกครั้งที่โหลดหน้า (ไม่ใช่เลข id ตามที่ชีตเขียน) จึงเปรียบเทียบด้วยชื่อชุมชน ไม่ใช่ URL
- เคสที่พึ่งข้อมูลที่ Dev ยังไม่มี (FAQ, รายละเอียดบทความ, อัลบัม) ยังเป็น Pending และหน้าค้นหา (KM-FES) ยังเป็นเพียงต้นแบบหน้าจอ (ไม่มีฟอร์ม/ไม่เรียกเซิร์ฟเวอร์ ผลลัพธ์เป็นข้อมูลตัวอย่างตายตัว) จึงยังไม่เขียนเทสทับ

---

## 5. ⚠️ ข้อมูลทดสอบและการล้างข้อมูล (สำคัญ)

หน้า **จัดการผู้ใช้งาน** (`/admin/user/index`) เดิมคาดว่า **ไม่มีปุ่มลบผู้ใช้** (ตามที่ระบุใน sheet สเปกฟอร์ม) แต่จากการรันจริง 2026-09-24 พบว่าบัญชีที่สร้างเอง (ไม่ใช่บัญชีระบบ) มีปุ่มที่เปิด dialog "ต้องการลบข้อมูล?" ได้ — และ **ยืนยันจนจบแล้วเมื่อ 2026-09-25** (TC-ADMU-03-02: กด "ยกเลิก" ผู้ใช้ยังอยู่, กด "ยืนยันลบข้อมูล" ผู้ใช้หายและ login ไม่ได้) เทสที่กด "บันทึก" สำเร็จยังทิ้งผู้ใช้ไว้บน Dev เสมอ ให้ล้างด้วยสคริปต์ด้านล่าง

**ล้างข้อมูลทดสอบ:** `npm run cleanup:data` (ผู้ใช้ + สิทธิ์การใช้งาน; ค่าเริ่มต้นเป็นโหมดดูรายการเฉย ๆ ไม่ลบอะไร) แล้วสั่งลบจริงด้วย `npm run cleanup:data -- --delete` (ลองทีละรายการ: `-- --delete --limit 1`) เลือกเฉพาะอย่างได้ด้วย `npm run cleanup:users` / `npm run cleanup:roles` / `npm run cleanup:categories` (หมวดหมู่: ลบเฉพาะการ์ดที่มี `[Auto Test]` ในชื่อหรือ "หัวข้อย่อย" — `AUTO_CAT_001` ที่ QA สร้างเองไม่มีป้าย จึงไม่ถูกแตะ) สคริปต์ล้างผู้ใช้ก่อนเสมอ เพราะสิทธิ์จะลบได้ก็ต่อเมื่อไม่มีผู้ใช้ถือสิทธิ์นั้นแล้ว **สิทธิ์ (role)** ลบเฉพาะแถวที่มีปุ่มลบ + มี `[Auto Test]` ในชื่อหรือคำอธิบาย + จำนวนผู้ใช้เป็น 0 (สิทธิ์ของระบบและสิทธิ์ของ QA เอง "ตรวจสอบข้อมูลระบบ" ไม่ถูกแตะ; ลบเพิ่มด้วย `--include-role "<ชื่อเป๊ะ ๆ>"`) ส่วน **ผู้ใช้** ลบเฉพาะ username ที่ automation สร้าง (`qa_auto_…`, สำเนาตัวพิมพ์ใหญ่ `QA_AUTO_…` และ username ภาษาไทยของ TC-ADMU-05-08 ที่มีชื่อ `[Auto Test]`) ไม่แตะ `admin` หรือผู้ใช้จริง รายการที่คล้ายแต่ไม่ตรงรูปแบบ (เช่น `ADMIN`) จะถูกรายงานให้ตัดสินเอง ลบได้ด้วย `--include "ADMIN"` มี log ทุกครั้งที่ `evidence/cleanup-*.md` รายการผู้ใช้แบ่งหน้าไม่นิ่งเมื่อชื่อซ้ำ สคริปต์จึงกวาดซ้ำจนไม่เหลือ

เพื่อความปลอดภัย เทสกลุ่มนี้ (สร้างข้อมูลจริง) จะ **skip โดยอัตโนมัติ** เว้นแต่จะตั้งค่าใน `.env`:

```
ALLOW_DATA_CREATING_TESTS=true
```

**คำแนะนำ:** เปิดใช้เฉพาะเมื่อแน่ใจว่า `BASE_URL` เป็นสภาพแวดล้อมทดสอบที่ยอมรับได้หากมีข้อมูลตัวอย่างเพิ่มขึ้นเรื่อย ๆ ทุกครั้งที่รัน (ตอนนี้ทดสอบบน **Dev**) และควรมีการล้างข้อมูลเหล่านี้เป็นระยะ

**ข้อมูลที่เทสสร้างมี flag ให้ตามลบได้ทุกรายการ** (กำหนดใน `src/utils/testData.ts` และ `src/utils/strings.ts`):

| ตำแหน่ง | ค่า | หมายเหตุ |
|---|---|---|
| ชื่อ-นามสกุล | ขึ้นต้นด้วย `[Auto Test]` | ค่าเริ่มต้นของทุกเคส ยกเว้นเคสที่กำลังทดสอบช่องชื่อเอง (SC-FUSR-03) |
| หน่วยงาน | ขึ้นต้นด้วย `[Auto Test]` | ค่าเริ่มต้นของทุกเคส ยกเว้นเคสที่กำลังทดสอบช่องหน่วยงานเอง (SC-FUSR-05) |
| username | ขึ้นต้นด้วย `qa_auto_` | ทุกเคสที่ค่า username ไม่ใช่สิ่งที่ทดสอบ |

ช่องที่เทสกำลังทดสอบอยู่ใส่ flag ไม่ได้ (เพราะค่านั้นคือสิ่งที่ตรวจ) แต่ช่องอื่นของผู้ใช้คนเดียวกันยังมี flag เสมอ ผู้ใช้ที่ username ถูกทดสอบเอง (เช่น `<script>alert(1)</script>`) จึงไม่มี prefix `qa_auto_` แต่ยังมี `[Auto Test]` ที่ชื่อ ในหน้ารายการผู้ใช้ให้มองหา `[Auto Test]` ที่ชื่อ หรือ `qa_auto_` ใต้ชื่อ (คอลัมน์ชื่อแสดงทั้งชื่อและ username — ทุกแถวที่เทสสร้างมีอย่างใดอย่างหนึ่งอย่างน้อยหนึ่งอย่าง) **อย่าพึ่งช่องค้นหาของหน้านี้** เพราะตรวจแล้ว (2026-09-25) ว่าไม่กรองรายการเลย แม้พิมพ์คำที่ไม่มีอยู่และกด Enter ก็ยังขึ้นครบทุกแถว ส่วนช่องหน่วยงานที่มี flag ไม่แสดงในตาราง ต้องกดเข้าหน้าแก้ไขดู (ตรวจแล้วว่า `[Auto Test] ทดสอบอัตโนมัติ` ถูกบันทึกจริง)

**ข้อมูลค้างก่อนเพิ่ม flag (2026-09-24/25) ไม่มี `[Auto Test]`** — ชื่อเป็น "ผู้ใช้ทดสอบอัตโนมัติ" แบบเดิม ต้องลบตาม username โดยตรง: `qa_auto_mufc1ppy_email12`, `<script>alert(1)</script>`, `ADMIN` (อาจมีรายการอื่นที่เกิดจากเทสรอบก่อน ๆ ที่ยังไม่พบ)

---

## 6. สมมติฐานที่ต้องยืนยันกับหน้าจอจริง

เทสถูกเขียนจากข้อมูลใน sheet "URL & ข้อสังเกต" และ "สเปกฟอร์ม (จากหน้าจอจริง)" ซึ่งยืนยันแล้วเป็นส่วนใหญ่ แต่บาง locator ยังเป็นการเดาที่สมเหตุสมผล (มีคอมเมนต์ `TODO` กำกับไว้ในโค้ด) เช่น:

- ข้อความ error บนหน้า Login (`LoginPage.errorMessage`) — ใช้ selector กว้าง (`.alert, .invalid-feedback, [role="alert"]`)

รันเทสจริงแล้วดู error/screenshot ใน `playwright-report/` เพื่อแก้ selector ให้ตรงกับหน้าจอจริงได้เลย โครงสร้างของ Page Object ถูกออกแบบให้แก้ที่เดียว (ในไฟล์ `src/pages/**`) แล้วมีผลกับทุกเทสที่ใช้ Page Object นั้น

หมายเหตุ: การเชื่อมต่อไปยัง `192.100.10.26:8081` **ไม่สามารถทำได้จากเครื่องที่ผมใช้รันงานนี้** (อยู่นอกวง network) เทสจึงถูกรันจริงโดยผู้ใช้เท่านั้น — ผลรันจริงหลายรอบช่วยแก้ locator ที่เดาผิดไปแล้วหลายจุด (เช่น modal ที่เป็น `<dialog>` ไม่ใช่ Bootstrap `.modal`)

---

## 7. วิธีนำเคส Pending มา Implement จริง

1. เปิด `tests/pending/<module>.pending.spec.ts` หาเคสที่ต้องการ (มี Script/Expected Result/Remarks เป็นคอมเมนต์ครบอยู่แล้ว)
2. ย้าย/เขียนใหม่เป็นไฟล์เทสจริง ตามแบบใน `tests/auth/*.spec.ts` หรือ `tests/admin/user-management/*.spec.ts`:
   - ใช้ Page Object จาก `src/pages` (เพิ่มไฟล์ใหม่ถ้ายังไม่มีสำหรับหน้านั้น)
   - import `test, expect` จาก `@fixtures/pages.fixtures` (ไม่ใช่ `@playwright/test` ตรง ๆ ถ้าต้องใช้ page object fixture)
   - ตั้งชื่อเทสให้ขึ้นต้นด้วย Test Case ID เดิมเสมอ เช่น `TC-FUSR-03-01 [High] ...` เพื่อ trace กลับไฟล์ Excel ได้ (สคริปต์ evidence ใช้ ID นี้ตั้งชื่อไฟล์ด้วย)
3. เพิ่ม Test Case ID นั้นใน `scripts/implemented-cases.json`
4. รัน `npm run generate:all` เพื่ออัปเดต `tests/pending/*.pending.spec.ts` (เคสที่ implement แล้วจะหายจาก pending อัตโนมัติ) และ `TRACEABILITY.md`

---

## 8. เมื่อไฟล์ Excel เปลี่ยน (เพิ่ม/แก้เคสทดสอบ)

```powershell
npm run generate:all
```

จะอ่านไฟล์ `.xlsx` ทั้งสองไฟล์ใหม่ทั้งหมด สร้าง `tests/pending/*.pending.spec.ts` และ `TRACEABILITY.md` / `traceability.csv` ใหม่ตามข้อมูลล่าสุด (เคสที่ implement ไปแล้วจะไม่ถูกสร้างซ้ำใน pending)

> หมายเหตุด้านความปลอดภัย: `scripts/lib/extract-cases.js` ใช้ package `xlsx` (SheetJS Community Edition) ซึ่งมีช่องโหว่ที่ทราบแล้วแต่ยังไม่มี patch บน npm ใช้เฉพาะเป็นเครื่องมือ dev สำหรับอ่านไฟล์ Excel ที่เชื่อถือได้ในเครื่อง ไม่ได้ถูกใช้ตอนรันเทสจริงหรือ deploy จึงยอมรับความเสี่ยงนี้ได้ — ถ้าต้องการตัดออก ให้เปลี่ยนไปใช้ SheetJS CDN build ที่ patch แล้วแทน

---

## 9. เก็บ Evidence ของการรัน (ทั้งเคสที่ผ่านและไม่ผ่าน)

```powershell
npm run test:evidence                    # รันทั้งหมด
npm run test:evidence -- tests/auth      # รันเฉพาะบางส่วน (อาร์กิวเมนต์ส่งต่อให้ Playwright)
```

คำสั่งนี้เปิดโหมดเก็บ **screenshot + วิดีโอของทุกเคส** (รวมเคสที่ผ่าน) แล้วจัดผลลงโฟลเดอร์ใหม่ทุกครั้งที่รัน ไม่เขียนทับรอบก่อน:

```
evidence/2026-09-25_1630/
├─ summary.md        ← เปิดไฟล์นี้ก่อน: เคสไม่ผ่าน + เคสที่ถูกกระทบ/บล็อก + skip + known bug
├─ results.csv       ← ทุกเคส 1 แถว (เปิดใน Excel ได้ ใช้เป็นข้อมูลอัปขึ้น Notion ได้)
├─ screenshots/      ← ตั้งชื่อตาม Test Case ID เช่น TC-AUTH-01-01.png
├─ videos/           ← TC-AUTH-01-01.webm
├─ errors/           ← error-context.md ของเคสที่ล้ม (มี page snapshot ตอนพัง)
├─ attachments/      ← ไฟล์ JSON/ข้อความที่เทสแนบเอง (เช่น status code ของเทส API ที่ไม่มีหน้าให้ถ่ายภาพ)
├─ report/           ← HTML report (เปิด index.html หรือ npx playwright show-report <โฟลเดอร์นี้>)
└─ junit.xml / results.json
```

**รอบทดสอบ:** `npm run test:new` = Test ใหม่ (ลบ evidence เก่าทั้งหมดแล้วรันตั้งแต่ต้น), `npm run test:continue` = ทดสอบต่อจากล่าสุด (รันเฉพาะเคสที่รอบนี้ยังไม่มีผล, `-- --retry-failed` รวมเคสไม่ผ่าน), `npm run test:round` = สรุปรอบ → `evidence/round-summary.md` + `evidence/round-results.csv` (ดู `scripts/test-round.js`)

**หน้า Loading:** ทุกหน้ารอ `#pageLoader` ("รอสักครู่ กำลังเตรียมข้อมูล") หายก่อนทำอะไรต่อ ติดตั้งให้อัตโนมัติจาก `src/fixtures/pages.fixtures.ts` (`src/utils/pageLoader.ts`) วิดีโอ evidence จึงเห็นหน้าเว็บจริง ไม่ใช่หน้า Loading — spec ใหม่ต้อง import `test` จาก `@fixtures/pages.fixtures`

ย้ายหรือลบโฟลเดอร์ `evidence/<วันเวลา>/` ได้อิสระ แต่ละรอบอยู่ครบในตัวเอง ส่วน `test-results/` และ `playwright-report/` ที่ Playwright สร้างเองจะถูกล้างทุกรอบ ถ้าจะเก็บผลรอบไหนไว้ให้ใช้ `test:evidence`

**"เคสที่ถูกบล็อก" ใน summary.md** — เทสแต่ละตัวเป็นอิสระต่อกัน ไม่มี dependency จริง จึงรายงานจาก 3 สัญญาณที่สังเกตได้:
1. **สาเหตุร่วม (RC-n):** หลายเคสพังที่ error เดียวกัน ณ บรรทัดโค้ดเดียวกัน (เช่น Page Object จุดเดียวพัง) — แก้จุดเดียวมักผ่านพร้อมกันทั้งกลุ่ม
2. **Skip เพราะเงื่อนไขไม่ครบ:** จัดกลุ่มตามเหตุผล เช่น ยังไม่ตั้ง `ALLOW_DATA_CREATING_TESTS=true`
3. **login ของ global setup ไม่สำเร็จ:** เคสที่ใช้ session admin ถูกกระทบทั้งหมด

สถานะที่ใช้: Pass / Fail / Known bug (เคสที่ตั้ง `test.fail()` ไว้และพังตามคาดด้วย assertion) / ผ่านโดยไม่คาดคิด (มี `test.fail()` แต่กลับผ่านจริง — บั๊กอาจถูกแก้แล้ว) / Skip / พักไว้ (On hold: เขียนเทสแล้วแต่ตั้ง `test.fixme(true, 'เหตุผล')` รอตัดสินใจ เช่น รอ dev & SA) / Pending (ยังไม่ได้เขียน) — เคสที่ตั้ง `test.fail()` ไว้แต่ล้มด้วย timeout นับเป็น **Fail** เพราะยังไม่ได้พิสูจน์ว่าเป็นบั๊กที่ตั้งใจจับ

**เทสที่ Logout ต้องล็อกอินเป็น session ของตัวเอง** (`context.clearCookies()` แล้วใช้ `loginPage.loginAndWaitForDashboard(...)`) เพราะการ Logout ทำลาย session ที่ฝั่ง server — ถ้าใช้ session ร่วมของ global setup เทสถัดไปทั้งหมดจะหลุดไปหน้า login (พบจากการรัน test:evidence รอบแรก 2026-09-25)

ถ้าต้องการภาพ ณ จุดที่พิสูจน์ผลลัพธ์ ให้แนบเพิ่มในเทสด้วย `test.info().attach('ชื่อภาพ', { body: await page.screenshot(), contentType: 'image/png' })` (ตัวอย่างใน TC-AUTH-01-01) ภาพจะถูกเก็บเป็น `screenshots/<TC-ID>__<ชื่อภาพ>.png`

> ⚠️ ภาพและวิดีโอมีข้อมูลจริง (เช่น อีเมลผู้ใช้ในตาราง) โฟลเดอร์ `evidence/` จึงอยู่ใน `.gitignore` — ตรวจไฟล์ก่อนส่งให้คนนอกทีม (ยังไม่ได้ทำการปิดบังข้อมูลอัตโนมัติ)
