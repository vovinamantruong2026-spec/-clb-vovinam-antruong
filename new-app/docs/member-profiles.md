# Hồ sơ cá nhân và danh bạ thành viên

Mỗi tài khoản lưu họ tên, ngày sinh, điện thoại và cấp đai Vovinam tại Hồ sơ cá nhân. Các tài khoản đã xác minh email và được cấp quyền hoạt động trong CLB có thể đọc các hồ sơ đã lưu, kể cả ngoài lớp phụ trách. Chỉ chủ hồ sơ được sửa thông tin và ảnh của mình; quyền, email đăng nhập, lớp phụ trách vẫn do chủ CLB quản lý.

Frontend được xuất bản cùng GitHub Pages. Để bật quyền lưu các trường mới và đọc hồ sơ của nhau, cần triển khai Firestore Rules mới trên đúng Firebase project:

```sh
cd ~/antruong-backup-2026/new-app
git pull --ff-only origin main
npx firebase-tools deploy --project clb-vovinam-antruong-2026 --only firestore:rules
```

Nếu chưa có checkout, tải repository mới vào một thư mục trống rồi chạy lệnh deploy trong new-app. Không triển khai Functions, Storage hoặc ghi lại dữ liệu.

Sau khi Rules đã được triển khai: tải lại trang, mở Hồ sơ cá nhân, lưu thông tin rồi kiểm tra trên một tài khoản CLB khác. Tài khoản khác chỉ xem được, không sửa được hồ sơ đó. Ngày sinh và số điện thoại được chia sẻ trong CLB theo yêu cầu; không hiển thị công khai trước đăng nhập.

Ảnh và thông tin được lưu hợp nhất để không xóa lẫn nhau; JSON sao lưu/khôi phục giữ các trường mới.
