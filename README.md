# Sơ đồ tổ chức Falcon — bản server tự host (Google Sign-In)

Bản này khác bản HTML tĩnh cũ ở chỗ: có một server Node.js nhỏ đứng giữa,
xác thực đăng nhập Google thật (chữ ký JWT do Google ký) và chỉ trả dữ liệu
nhân sự (`DATA`/`TEAMS`) cho những phiên đã đăng nhập hợp lệ bằng email
`@falcongames.com`. Vì dữ liệu không còn nhúng sẵn trong file HTML gửi về
trình duyệt nữa, người chưa đăng nhập sẽ không lấy được dữ liệu dù có mở
DevTools / View Source.

## 1. Cấu trúc thư mục

```
server-app/
  server.js              ← server Express
  package.json
  .env.example           ← copy thành .env rồi điền giá trị thật
  data/org-data.json     ← dữ liệu nhân sự (DATA + TEAMS), chỉ server đọc được
  public/
    index.template.html  ← trang chính (server chèn Client ID vào khi render)
    app.js                ← toàn bộ logic UI (cây tổ chức, PDF export, v.v.)
```

## 2. Tạo Google OAuth Client ID (bắt buộc — bước này chỉ bạn làm được)

Vì Client ID gắn với domain nơi bạn deploy và với tài khoản Google Cloud của
công ty, mình (Claude) không thể tạo hộ bước này. Làm theo các bước sau:

1. Vào **https://console.cloud.google.com/** (đăng nhập bằng tài khoản
   Google Workspace quản trị falcongames.com, hoặc tài khoản có quyền tạo
   project trong tổ chức).
2. Nếu chưa có project riêng cho việc này: bấm chọn project ở góc trên →
   **New Project** → đặt tên (VD "Falcon Org Chart") → Create.
3. Vào **APIs & Services → OAuth consent screen**:
   - User Type: chọn **Internal** nếu tài khoản Google Cloud của bạn thuộc
     tổ chức Google Workspace falcongames.com (khuyến nghị — chỉ user trong
     domain mới đăng nhập được, không cần Google duyệt app).
   - Nếu không có Google Workspace (chỉ có Gmail thường), chọn **External**
     và thêm các email cần dùng vào mục Test users, hoặc submit để Google
     duyệt public (không bắt buộc cho nội bộ, có thể để ở chế độ Testing).
   - Điền tên app, email hỗ trợ, logo (tuỳ chọn) → Save.
4. Vào **APIs & Services → Credentials** → **Create Credentials** →
   **OAuth client ID**.
   - Application type: **Web application**.
   - Name: VD "Falcon Org Chart Web".
   - **Authorized JavaScript origins**: thêm đúng (các) domain bạn sẽ
     deploy, ví dụ:
     - `https://org.falcongames.com` (domain thật khi deploy production)
     - `http://localhost:3000` (để test ở máy local, tuỳ chọn)
   - **Authorized redirect URIs**: để trống — bản này dùng luồng đăng nhập
     bằng nút "Sign in with Google" (ID token), không cần redirect URI.
   - Bấm **Create**. Google sẽ hiện **Client ID** dạng
     `xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com`
     — copy giá trị này.

Lưu ý: Client ID không phải bí mật (không cần giấu), nó sẽ xuất hiện công
khai trong HTML gửi về trình duyệt — đó là thiết kế bình thường của Google
Sign-In. Phần thật sự cần giữ kín là `SESSION_SECRET` ở bước sau.

## 3. Cấu hình server

```bash
cd server-app
cp .env.example .env
```

Mở `.env` và điền:

- `GOOGLE_CLIENT_ID` — Client ID vừa tạo ở bước 2.
- `ALLOWED_DOMAIN` — mặc định `falcongames.com`, để nguyên nếu đúng domain
  công ty.
- `ADMIN_EMAILS` — danh sách email được cấp quyền Admin, cách nhau dấu
  phẩy. Hiện tại: `dungdt@falcongames.com,mynth@falcongames.com`. Thêm/bớt
  người tuỳ ý — sửa xong khởi động lại server là áp dụng ngay, không cần
  sửa code.
- `SESSION_SECRET` — một chuỗi ngẫu nhiên dài, dùng để ký session (khác gì
  với mật khẩu admin cũ — đây là bí mật kỹ thuật, không ai gõ). Tạo nhanh
  bằng lệnh:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
- `PORT` — cổng chạy server (mặc định 3000).
- `NODE_ENV=production` khi chạy thật (bắt buộc để cookie đăng nhập được
  đánh dấu `secure`, chỉ gửi qua HTTPS).

## 4. Chạy thử ở máy local

```bash
npm install
npm start
```

Mở `http://localhost:3000`. Vì Google Sign-In chỉ chạy được trên
`https://` hoặc `http://localhost`, test ở localhost là được, không cần
HTTPS lúc dev. Nhớ đã thêm `http://localhost:3000` vào Authorized
JavaScript origins ở bước 2 nếu muốn test theo cách này.

## 5. Deploy lên server tự host

Ví dụ dùng PM2 (tự khởi động lại nếu crash, chạy nền):

```bash
npm install -g pm2
cd server-app
npm install --production
pm2 start server.js --name falcon-org-chart
pm2 save
pm2 startup   # làm theo hướng dẫn để tự chạy lại khi server reboot
```

**Bắt buộc phải có HTTPS** (Google Sign-In không chạy trên `http://` thường,
trừ localhost). Cách đơn giản nhất: đặt Nginx làm reverse proxy phía trước,
dùng Let's Encrypt (certbot) cấp SSL miễn phí:

```nginx
server {
    listen 80;
    server_name org.falcongames.com;
    return 301 https://$host$request_uri;
}
server {
    listen 443 ssl;
    server_name org.falcongames.com;

    ssl_certificate     /etc/letsencrypt/live/org.falcongames.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/org.falcongames.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d org.falcongames.com
```

Sau khi có domain thật (VD `https://org.falcongames.com`), quay lại bước 2
và thêm domain này vào **Authorized JavaScript origins** của Client ID
(sửa xong bấm Save trên Google Cloud Console, có hiệu lực sau vài phút,
không cần đổi gì bên server).

## 6. Cập nhật dữ liệu nhân sự sau này

Dữ liệu giờ nằm ở `data/org-data.json` (không còn nhúng trong HTML). Khi có
CSV mới, đưa file JSON mới ghi đè `data/org-data.json` (giữ đúng cấu trúc
`{"data": [...], "teams": [...]}`) rồi:

```bash
pm2 restart falcon-org-chart
```

không cần restart Nginx.

## 7. Khác biệt so với bản HTML tĩnh trước đây

- Trước: ai cũng "đăng nhập" được bằng cách gõ bừa một email đúng đuôi
  @falcongames.com — không xác thực thật, dữ liệu nhân sự vẫn nằm sẵn
  trong file HTML dù chưa đăng nhập (xem được qua View Source).
- Giờ: phải đăng nhập bằng tài khoản Google thật thuộc domain
  falcongames.com (Google xác thực + ký token, server xác minh chữ ký đó).
  Dữ liệu nhân sự chỉ được server gửi về sau khi xác thực thành công —
  người chưa đăng nhập không lấy được dữ liệu qua bất kỳ cách nào từ trình
  duyệt.
- Quyền Admin/Nhân viên giờ do `.env` (`ADMIN_EMAILS`) trên server quyết
  định — không còn ô nhập mật khẩu admin dùng chung ở giao diện nữa (đăng
  nhập đúng email được cấp quyền là tự vào thẳng Admin).
- Các tính năng khác (xem cây tổ chức, filter, export PDF/CSV/Excel,
  kéo-thả sắp xếp cho Admin...) giữ nguyên như bản cũ, chỉ khác nguồn dữ
  liệu và cách đăng nhập. Lưu ý: thay đổi kéo-thả của Admin vẫn chỉ áp
  dụng trong phiên làm việc (chưa lưu xuống `org-data.json`) — dùng
  Import/Export như trước để nạp/lưu dữ liệu.
