// CỬA GITHUB cho trang quản lý (quan-ly.html chạy trên GitHub Pages): mọi lệnh api() đi qua hộp thư GitHub thay vì gọi thẳng bot.
// Hộp thư: vao/<id>.bin (trang ghi) -> bot làm -> ra/<id>.bin (bot ghi). File = chữ base64 của (iv12 | AES-GCM).
// Khoá = PBKDF2-SHA256(khoá trang, "tsc-cua-github-v1", 200000) — giống cua-github.js phía bot.
(() => {
  const API = "https://api.github.com/repos/", MUOI = "tsc-cua-github-v1", VONG = 200000;
  let CH = null, KEY = null, TOKEN = null;
  const ngu = (ms) => new Promise((r) => setTimeout(r, ms));
  const b64 = (u) => { u = new Uint8Array(u); let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const tuB64 = (s) => Uint8Array.from(atob(String(s).replace(/\s/g, "")), (c) => c.charCodeAt(0));
  const chu = (s) => new TextEncoder().encode(s);

  async function taoKhoa(k) {
    const goc = await crypto.subtle.importKey("raw", chu(k), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt: chu(MUOI), iterations: VONG, hash: "SHA-256" }, goc, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function maHoa(o) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, KEY, chu(JSON.stringify(o))));
    const r = new Uint8Array(12 + ct.length); r.set(iv); r.set(ct, 12); return r;
  }
  const giaiMa = async (u) => JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: u.subarray(0, 12) }, KEY, u.subarray(12))));
  /** sha của file trong git (để xoá mà không cần hỏi lại GitHub) */
  async function shaGit(txt) {
    const b = chu(txt), dau = chu(`blob ${b.length}\0`), all = new Uint8Array(dau.length + b.length);
    all.set(dau); all.set(b, dau.length);
    return [...new Uint8Array(await crypto.subtle.digest("SHA-1", all))].map((x) => x.toString(16).padStart(2, "0")).join("");
  }
  async function gh(method, p, body, raw = false) {
    for (let lan = 0; ; lan++) {
      const r = await fetch(API + CH.repo + "/contents/" + p, { method, cache: "no-store",
        headers: { authorization: "Bearer " + TOKEN, accept: raw ? "application/vnd.github.raw" : "application/vnd.github+json", ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined });
      if (r.status === 404) return null;
      if (r.status === 401) throw new Error("Token GitHub hết hạn/sai — báo chủ bot");
      if ((r.status === 409 || r.status >= 500) && lan < 4) { await ngu(800 * (lan + 1)); continue; }   // GitHub đang ghi việc khác -> thử lại
      if (!r.ok) throw new Error("GitHub " + r.status);
      return raw ? r.text() : r.json();
    }
  }
  /** gửi 1 việc, chờ bot trả lời */
  async function gui(viec, ghi = () => {}) {
    const id = crypto.randomUUID().replace(/-/g, "");
    ghi("Đang gửi…");
    await gh("PUT", "vao/" + id + ".bin", { message: "viec", content: btoa(b64(await maHoa({ ...viec, id, t: Date.now() }))) });
    const bd = Date.now();
    while (Date.now() - bd < 4 * 60_000) {
      ghi(`Chờ bot (${Math.round((Date.now() - bd) / 1000)}s)…`);
      await ngu(Date.now() - bd < 30_000 ? 2000 : 4000);
      const txt = await gh("GET", "ra/" + id + ".bin", null, true);
      if (txt == null) continue;
      const o = await giaiMa(tuB64(txt));
      shaGit(txt).then((sha) => gh("DELETE", "ra/" + id + ".bin", { message: "doc", sha })).catch(() => {});
      if (o.id !== id) throw new Error("kết quả lạ");
      return o.kq;
    }
    throw new Error("Bot chưa trả lời sau 4 phút (bot tắt/ngủ?) — thử lại sau");
  }

  function chuanKhoa(k) {
    let s = String(k || "").toLowerCase().replace(/[\s​ ]/g, "");
    const tron = s.replace(/[^a-z0-9]/g, "");
    if (/^[a-z0-9]{16}$/.test(tron) && /^[a-z0-9-]+$/.test(s)) s = tron.replace(/(.{4})(?=.)/g, "$1-");
    return s;
  }
  async function moKhoa(k) {
    if (!CH) throw new Error("Chưa tải được cau-hinh.json");
    for (const thu of [...new Set([chuanKhoa(k), String(k || "").trim()])]) {
      KEY = await taoKhoa(thu);
      try { TOKEN = await giaiMa(tuB64(CH.tk)); return thu; } catch { /* thử cách khác */ }
    }
    KEY = null;
    throw new Error("Sai khoá trang. Khoá dạng xxxx-xxxx-xxxx-xxxx trong file KHOA-TRANG-GITHUB.txt — không phải mật khẩu.");
  }

  // việc chạy ngầm (làm mới, bản sao) không hiện "Chờ bot"; chỉ 1 việc đọc trùng tên chạy cùng lúc
  const dangDoc = new Map();
  window.GH = {
    ghi: "Trang qua GitHub — mỗi thao tác chờ ~5 giây. Nhập khoá trang + mật khẩu.",
    moTrang() {
      document.getElementById("dn-gh").classList.remove("an");
      document.title = "Quản lý Bot (qua GitHub)";
      const k = localStorage.getItem("khoa_trang");
      if (k) { document.getElementById("dn-khoa").value = k; document.getElementById("dn-nho").checked = true; }
      fetch("cau-hinh.json", { cache: "no-store" }).then((r) => r.json()).then((j) => (CH = j)).catch(() => {});
      // tải file Fiin: qua hộp thư rồi lưu
      document.addEventListener("click", async (e) => {
        const a = e.target.closest("[data-fiin]");
        if (!a) return;
        e.preventDefault();
        try {
          window.bao?.("Đang lấy file Fiin qua GitHub (~10–20 giây)…");
          const j = await GH.api("fiin-file");
          if (j.loi) throw new Error(j.loi);
          const l = document.createElement("a");
          l.href = URL.createObjectURL(new Blob([tuB64(j.base64)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
          l.download = j.ten; l.click(); setTimeout(() => URL.revokeObjectURL(l.href), 10_000);
        } catch (e2) { window.bao?.(e2.message, true); }
      });
    },
    async dangNhap(khoa, mk, ma, ghi) {
      if (!CH) CH = await (await fetch("cau-hinh.json", { cache: "no-store" })).json();
      const k = await moKhoa(khoa);
      document.getElementById("dn-khoa").value = k;
      if (document.getElementById("dn-nho").checked) localStorage.setItem("khoa_trang", k); else localStorage.removeItem("khoa_trang");
      const kq = await gui({ dang_nhap: { mat_khau: mk, ma } }, ghi);
      if (kq.can_ma) return kq;
      if (kq.loi) throw new Error(kq.loi);
      sessionStorage.setItem("phien", kq.phien);
      return kq;
    },
    async api(p, body) {
      if (p === "dang-xuat") { sessionStorage.removeItem("phien"); return { ok: true }; }
      const ph = sessionStorage.getItem("phien");
      if (!ph || !KEY) return { can_dang_nhap: true };
      const doc = body === undefined;                       // GET ở trang thường = chỉ đọc -> gộp các lần gọi trùng
      if (doc && dangDoc.has(p)) return dangDoc.get(p);
      const viec = gui({ phien: ph, p, body: body ?? {} }).then((kq) => { if (kq?.can_dang_nhap) sessionStorage.removeItem("phien"); return kq; });
      if (doc) { dangDoc.set(p, viec); viec.finally(() => dangDoc.delete(p)); }
      return viec;
    },
  };
})();
