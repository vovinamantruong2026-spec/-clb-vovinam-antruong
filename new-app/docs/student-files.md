# Ảnh, hồ sơ võ sinh và kiểm tra trùng

## Triển khai trên dự án đã có sao lưu tuần

Trong Cloud Shell đã đăng nhập đúng chủ dự án:

```sh
cd ~/antruong-backup-2026/new-app
git pull --ff-only origin main
npx firebase-tools deploy --project clb-vovinam-antruong-2026 --only functions:studentFiles
```

Dùng lại tài khoản dịch vụ `weekly-clb-backup` và bucket riêng tư đã thiết lập bởi `scripts/setup-weekly-backup.sh`. Không cần thay Firestore Rules. Không triển khai đè các hàm hoặc Rules khác.

Nếu dự án chưa có bucket/IAM của sao lưu tuần, chạy script thiết lập trước. Script nay có thêm `studentFiles`.

## Cách dùng

Võ sinh → Chi tiết → Ảnh & hồ sơ võ sinh. Hồ sơ mới cần lưu trước khi thêm tệp. Chọn ảnh hoặc tệp sẽ tự lưu sau khi máy chủ xác nhận, độc lập với nút lưu thông tin võ sinh.

- Ảnh được xử lý thành JPG vuông 256px.
- Hồ sơ nhận PDF, JPG, PNG, WebP tối đa 5 MB/tệp, tối đa 30 tệp/võ sinh.
- CCCD mặt trước/mặt sau: chỉ chủ CLB được thêm và tải.
- Chứng chỉ đẳng cấp: chủ CLB hoặc tài khoản có `students_direct` trong lớp được cấp.
- Ảnh: người có quyền đọc võ sinh trong lớp được xem; thay ảnh cần quyền quản lý võ sinh.
- Tệp tải qua HTTP đã xác thực, không dùng đường dẫn công khai hoặc Firebase download token. Loại tệp được kiểm tra qua chữ ký nội dung. Quyền được kiểm tra lại trong transaction khi lưu.
- Tệp được lưu bất biến trong `student-files/antruong-v2/{studentId}/{uuid}` của bucket riêng tư. Không đưa ảnh dạng base64 vào bản ghi võ sinh. Vòng dọn bản sao lưu tuần chỉ quét prefix `weekly/`, không xóa hồ sơ.
- JSON và sao lưu tuần giữ metadata/liên kết tệp trong bản ghi. Khôi phục JSON trong cùng dự án giữ truy cập tới tệp. **Nội dung tệp không nhúng trong JSON**; chuyển dự án hoặc cần bản sao độc lập thì phải tải riêng tệp. Phiên bản này chưa cung cấp xóa tệp vĩnh viễn hay chuyển tệp giữa dự án.

## Trùng họ tên và năm sinh

Chuẩn hóa khoảng trắng, chữ hoa/thường và dấu tiếng Việt; so họ tên đầy đủ và năm sinh. Không so khi thiếu năm sinh. Có tính hồ sơ đã nghỉ nhưng loại hồ sơ trong thùng rác. Phạm vi cảnh báo là dữ liệu tài khoản được đọc. Có nhãn và bộ lọc danh sách, cảnh báo trực tiếp trong biểu mẫu, xác nhận trước khi lưu. Không gộp, xóa hoặc đánh lại mã.

## Kiểm tra

```sh
npm run build
npm run test:student-files
npm run test:student-policy
npm run test:sync:build
firebase emulators:exec --project demo-antruong-v2 --only firestore,auth 'node tests/rules.mjs && node tests/sync/live.mjs'
```

Sau triển khai thực tế, thử ảnh/CCCD mẫu không chứa dữ liệu thật, tải lại trang và tải tệp để xác nhận lưu; kiểm tra một HLV được cấp lớp và một HLV ngoài lớp. Chỉ coi kho hồ sơ hoạt động thật sau bước này.
