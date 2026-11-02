# CLB Vovinam An Trường

Link gọn sau khi đổi tên kho thành `vovinamantruong2026-spec.github.io`: [Mở trang CLB](https://vovinamantruong2026-spec.github.io/).

- `new-app/`: mã nguồn ứng dụng đang hoạt động.
- `v2/`: bản chạy trên GitHub Pages.
- `index.html`: mở ứng dụng ngay tại đường dẫn gốc, không chuyển sang `/v2/`.
- `dang-nhap.html`: chuyển về trang chính.
- `-clb-vovinam-antruong/`: giữ điểm chuyển tiếp cho các link cũ sau khi đổi tên kho.
- Chạy `npm run build:pages` trong `new-app/` để cập nhật đồng thời trang gốc và `/v2/`.

Mã giao diện cũ đã được lưu tại nhánh [`archive/legacy-before-v2-redirect-20261102`](https://github.com/khangduy1810/clb-vovinam-antruong/tree/archive/legacy-before-v2-redirect-20261102). Đây là bản dự phòng mã nguồn; việc gỡ giao diện không xóa dữ liệu Firebase hay dữ liệu đã lưu trong trình duyệt.
