// Injected into every page's MAIN world by content.js. Exposes an EIP-1193
// provider and announces it via EIP-6963 so any dapp can discover "Atomic Pay"
// alongside MetaMask etc. Requests are relayed to the content script (isolated
// world) and on to the background service worker — this script holds NO keys and
// NO secrets; signing is escorted to an atomicpay.cloud iframe in the popup.
(function () {
  if (window.__atomicPayInjected) return;
  window.__atomicPayInjected = true;

  const CHANNEL_REQ = 'atomic:pay:req';
  const CHANNEL_RES = 'atomic:pay:res';
  const CHANNEL_EVT = 'atomic:pay:evt';
  const pending = new Map();
  let reqId = 0;

  const listeners = { accountsChanged: [], chainChanged: [], connect: [], disconnect: [] };
  function emit(event, payload) { (listeners[event] || []).forEach((fn) => { try { fn(payload); } catch (_) {} }); }

  const provider = {
    isAtomicPay: true,
    // Default to Base (8453) — Atomic's home chain — until the wallet reports otherwise.
    chainId: '0x2105',
    _connected: false,
    request(args) {
      const method = args && args.method;
      const params = (args && args.params) || [];
      if (!method) return Promise.reject({ code: -32600, message: 'Missing method' });
      return new Promise((resolve, reject) => {
        const id = ++reqId;
        pending.set(id, { resolve, reject });
        window.postMessage({ channel: CHANNEL_REQ, id, method, params }, '*');
      });
    },
    on(event, handler) { (listeners[event] || (listeners[event] = [])).push(handler); return provider; },
    removeListener(event, handler) {
      listeners[event] = (listeners[event] || []).filter((h) => h !== handler);
      return provider;
    },
    // Legacy shims some dapps still call.
    enable() { return provider.request({ method: 'eth_requestAccounts' }); },
    isConnected() { return provider._connected; }
  };

  // Responses from the content script.
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || typeof e.data !== 'object') return;
    if (e.data.channel === CHANNEL_RES) {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.error) p.reject(e.data.error);
      else {
        if (e.data.method === 'eth_requestAccounts') provider._connected = true;
        p.resolve(e.data.result);
      }
    } else if (e.data.channel === CHANNEL_EVT) {
      if (e.data.event === 'chainChanged') provider.chainId = e.data.payload;
      emit(e.data.event, e.data.payload);
    }
  });

  // ---- EIP-6963: multi-wallet discovery ----
  const info = {
    uuid: (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()),
    name: 'Atomic Pay',
    rdns: 'cloud.atomicpay',
    // Atomic mark (64x64 PNG), shown in EIP-6963 wallet-selection UIs.
    icon: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAQKADAAQAAAABAAAAQAAAAABGUUKwAAAQOUlEQVR4Ae1aCXhUVZY+b60tlUplqawkJIEEEkQWAVmCUXEE2tBiG5QWlRFHbTI2DY1MT7tQDj2MjPbQyowIijDd8oEEQaTFli1BUWSJQIeEMAESsieVpVJLqt6rt8y5VVmAVqESjfN9U/f7Xl5VvXvPPf9/lnvufQEItRADIQZCDIQYCDEQYiDEQIiBEAMhBkIM/D9kgPoRMV8/t/pj6EL/CJMS4Hj58XaD9t+6fx9cjQabgG7gVrxTsLfBEf3Gvn08wMv4nfzWS8SgsTCYBAQAWhFsfhalItiDqnblley7piN4BfLL8DkhYnBJYAaJ6j7wxUDDPptKlWWnV2sMG4BS+fS60R+V2ygKJmQBlO9ElYoHSS1AZQatoXXLsihwxiMZVqWeN+Z7edrgAHpO6rKJGVBcpoKtHL2DeMK3egE+I/mDXGr31fPdfw8azWAQQBQFP7DLHTSUNFLzNxRFO2l60aVqEezAmpwJMfkAhQrYsmiwZVNAwqSPBPzcCxg/WvE5uUgf8oh0xO99/clvN90GgwBUBpW1LabAIuB8Vili2oS8doVNr6x0wJVmBUSW/YeHN+2Ph7LPsR96JfGU3nxAvIFgRBn5hTTk4nMreonVqmzeXKT5bVXHmPEb4jGUryHt/wwBAcsQt7YdoeF8O5X/1AajneMX1jcKINgFqLGp0KZySZbJE2cDrJMhBgFePkiTROkH5Qc+j8a0QEMhhkixVdqxdDI/u9L90zdm5uw/zemX5jU2yr39g/SEQfAAYn106+RICqr3ysZH8ia1SsyUuopWAFmFri4Vau0UeI36R6f9YqsRnAjUosFQIPkASSDecHkGEmBVrdYYbc5Z+89eKHj24xJWt7tey+S4fcr5lVbrVfnjpo3v78gG1z3Y3iT25xEAFAhueuhQI+WKND/S3CazjmY30CYDKCjyUoMMqSZmypgnZ0w8un51EYAWB5ZI3bOhJ+TDi2caR2zTmP+zhtbkKmg2RlJB5wJo6RJr/G5GkmtMFo4joRBwg5vR9ockIODCxPqd54inKdNfW5fZKLNz6s43gSpIkDpECzYtBXanCk0eho0wh81P/nnBiXsW/iTLZzSNdDMMpxXdp8+8/tbXF4+fao6cOH1ni44d5xCpcAWls15VYX2yA2XT/jlsUUjAzYMnBP2AIYC6WHEGZwNahqXh4jqla8jQuS1OiLBfsQPH05CcGg6x4dhHRi+oV8BN8zOnPz0374Qa8aCWhsgsXnA20boFsQUF9257Oq+V8wqtggoaBd3GR9OgKGpXqqsLYwkYGD4cb8G3H8oDAtYniasT4zkGYI51T0w7o3m48UIrKC4RLEOjIcrASiqjslXNKjS3y2AbwsWmW3SJpSNNy0rRwAhHWnS4saPao8pzt5/J+ExvWtOlMhpGVcAi+Wp8oDKJlbVNAAtJQUesH3T7ITwAwaMuJPP74xKtf2ytxN2Rc1erUx3RfhENRjMQPywGIt3Ot6JYuSzazIKCXlCNK4KL0y2Y+o/b4mGM1WCesSE8wuVoGbW/+PTXwzP/0M7yKWTpj1Pkk/d+9sW9E5wdv95+tsIOk0dTUFkJgRwQHAffNwEB8GTp6ol9BJ+dvVjTqdE/3lLrAsnuAaNFDxEmzlb1wbF3NQ7nvqQoCijUpK5VwiWRGZHx6J13wJldvo7mdvr9OZnnih++b0UDp52lYlo0+RR7WnXtP295ennNJxPnfmQvb/WBxqGCaRQGRiGiXxmUJ3yfBATAkyxMXL/YKi+cFkXN2XRx2i2rf3tHcxc1taOiEZ0D3Xd4LBgkYf/BVW/XO74q/zCOkzoNehq8GOANLoZWIow/T5yYo80s/bMUvt+2+Bxj+JXPH/yycmtnm/VSXs4xyF3Aw9T7WWhz43IQqYKxUYXs7B7wPfcbusP3tRnqA4+un2+wQfI/fTrqRNy0jV6KyWHiIpKuNPkm2svqgI/QQsq4eDGupur5spOXWuyH/tqR8cjdI9xaTVZbpwwenwqWCCZt+lDLBy1/v+juyvDo/xBUmuUZCoZ7XWs1i55bWz52NgsCpkKvRwZLJA66BQsogwpvLkbgqEoQbaAeQGbrA2/Fb+iFO7Cyd0j8416Zzk7S+7Y3dlEz7RX1AKIPTEPjwMQqR89sKjwLCdG0zcPIhvrm7egFEsdT4JJYEDuEA1diku86b7CsdftonqMpGCa4tma89l+rv5CTKfBQ14F/U4XCfAwBP/ibtj7haSAEdAPH+fKxVMVWhPJWrFmip9aYaVNzySuzbQdud4UZo9o65ARPfRvQWhbMieGKyd659cKBkx49i0Cy4+gzawu/NKnS1wkxHKSJ9nc9TY7PP1WiX3JKrJGlsIjscv4xZdPmpbvL7SLE6tQ+y+PSEUPAE9cPHjzRub8h0Gf1fBsN2ZSq5hbT94e9sqqcjn5m/vjwvVuXH/CGJego56jbXqursMX76ltAh9ZPSDef932yd1WNZJF9uBoA7YWmI6e84xbMokfyvnMtDrmzVBP5gkdhtBy6fZLg2BK5bu3yz0rqRIg0USBKAbdv0SiQdLwbvJVYnVxBt/54wFXgyYYFZy620rnmbS9ddut+o6eVr5xf7xAhk2MrSk5J0U7beq6hyQUMC6YUC4TL4o6jr69pByMO1Plk4MPQdTnV9/GRP39ZR8WXU6bnvTLDaTBZpgv2tdqVrywvqfbKkBRFg8kg4zgFCPg0sxKwfP/BE92D9YBrwZMNy74C+VBB7cOn2/RrE/We37/v/uXvnjo8ljUnaJmZD80073lm7NEpdz5wno6Nu0OTHO1Lqq/8zYVSyQXRLAVtopzw1Qfe3C3rppxIGre+mjLOlDEqNSC7xyqtq7ekOHwjxw737HrvcB0YTQC48wEH1o1ml0pOlbDU7LflCXjS+uMBgSKHgMel7qH1NaNKW7Vvmjnx4Hzj5y9nv5PEQPsJZdzc+zJORt32Yc6q47OLXv3JntQhTP4wzrOqaMvOeki0UHDovDd/bDIXu/XTZUfYtO0NkuE2Bdf5SEWomuWrX/LucE9SeLTppYxU8zxotcnAYuzznSpo41WIwdOjINf7ANy//RskAYRwstvCNI81ftmOHdzxWuZfsYyBe4a4V1gLXhYhJY6dVXdaadLG51W10mPOXvJsGfXswSUV24vK//Kr5zY7W9ukXMdH4l0bV04/NmXuztIu4yqHlzHzsgwpivPjxPPHf7oy0zdOZ454UhBF0LBU3gtvL4+FqktYK/5NIwoNqAVDgD/e/SUusX7JRqng0oQpNlF3X6JB3PTuorRSmPS0FiQP5XlutbnRxS6QquvA4VRMV9oV621TRmTlVx8UZhQUjKx9dtfGrzyWD+sEw3RJYTGsRftoumNF6u4/PVn60oNVdoGqEkUBJEkCrVaTOHNc4t9Bw0ZhQEi/ZXAwBKCIHuvHU6oVqAanZo4kqbRRsW8FmKwBnUzD8S2iN33a/YIAsbFic1mq0b3qnnRlTkfEEOOJ35/edFxJOXDJbZzfJWl4jepTU2jn7kli9axTj979ZvFlmwQZBdr39pV9KPp8dSzD4I5PAWMYv3B8/oYwqEUVvI2BMtuvS2Dt+xZsN/VzkASgTGJ9VGJeWT7rxFyvYB5l9foxO5bis+KlXbilUZI5x4XJutbHxmZG/Dose5z7S93kfznhjttzxRM+3ylowzhZhHhePD2G63xs7Md/eOLg4pXnYPIDGuDDFRgSrW6yvtfk8Up7WJbzewHL0ON/t3T67VD3meQ/MiPQrOTPwFu/t8PZNptyZjjUNvpYONOoe32ZftcD6S/KtXjKpTlUSUUqLJfqUU0ZIqXRKhSZhgINI0CkQSlJ1HS9Paz25N7t/17QAZNWcDApBzf3IIGxC8nFg9PIOLqizl44Xsc9gXGn43mei43QPwiQVgSQgvlHxKMyM1mRMAdgpdTPGoDQF4hr8unGDftaKcjFlcN/cgvKzH+bP/Zkm3l3m6hPJMMZ3PmqWLzgwo4qYc7CETwnAc8orfFh8pdhqmtbfNvJ4n2vru2EYfdyEIX9dNidxzqeNNGNZS7Kl7RUUjTP7H39Zzv1Ws2dMuYCWVFsh//aMHXJg1trYBb29UTJuOnCqQa2FAZPADmoLC9nILyTAVuFMuux17JqlMhFrS41r8WNEcWAjC6rDLNAh5aVzqog146mq3af3rOttvToJRHGTOGAwTM/oxGLGlaBVtzNke0saUInBcYEcojCwPFtvqJT//14XGTYehlXCI7nob3DtWzymPQ3INfK4SokQ16CDFay/cU3bf1swRRCSFYRQDYmQuetFOh9FERnshff2dRqgQOHIsOkP6XFRLZTvi6vXnFdkdzOLiHSfKvGxLVcfmPZrgrdBAaGWdBF0GoGSQGBxSoQy70WuwJKPL4cMKqQgltBpw/AgER2RjOWtJjmW9LM97Msa6LQ03FPFHHeNbqw2t4pgYOUkngIWk72ASQ5968FkwQDLJM9N9l717XhgT5ab+o0psw5njGbzdz/tNFLapy6RfVO/okab3h+o8COMoqd+y/asXjR4MbHp5Mx0slpLwJwyP6SNitL9pe1pLS1ITkxWQo4GQUyo+DVX66q9wryJ0hAbzJ8/he3T8ICzAdCG64GmJAHAJ5QFgwB2B3nIy5Hjp/JCQypyw20AiV/EdrV4Tl2gRumSgKGP7GiFmL0cCLm3P4TkJJBg0+Ue3dxznjyAgTr+YNYz5cHtrLkTiq8yx0qRGBoELkQQ9U0u98XBAGP/1QSBmx0uO6hgCL9OwQloK9uQRKADkwaUbbHC9Baufm5rEfhn8L1kOJ5LfC6MNDHREG8Vvjj7rfWOEB71f7dv5FB4CSBFe7oTmLEg5HYHu8Ka8dQQC/Izmbe2Xy4RFHhmCnCBMQTOJadt/PwmUy4+HnPewO/Sv39049lkCiL5oiZh0rOUEDTSBU36Khh8cI7CZxtu6pKFKZ+ilcYWbxQuReyF7LgjcAtLLp/7y6OACdyrETvAKlkObOi3PzCgBdYBMwL8dQnXxyTnmmc8WJnlzACu0oshRkWKAly8X3D99D6KwTHXbUkhoczcGyZiPoQeT1epcLoV3ngME+QY6te8N95cnOtXPKekDcwsH8LxlRZj8WRvFwWsnNpIPmDeOMAlsIBEIDzkpMgcvpL6gKiLHmvF2Xok0mSJMkTJOb9+3eiLLr6ty9bOJbgwaxejLKIXPJO0S71kAr+/FCDIUJyCMkZ/jDyT4kDg299goMbS0BgLsAVgShBlCEZnFhadPddXsz2PeCze8F/10wBuVbs0iOXeA5ZMXou8t0PHhOx/yjsu8Td+FkwdcD10pCBIvyXlnKACWWocK4KnTWYF3DJI2u6xoWZHM2ZlIyKIvhiv+WJjBtZCuUWo1wkduERXDCTcYgNVxUc1yPPgM8LSfFz0zJRxjc3nGxArXs8wYRua8VbGb4RIo1kdKv/E/7pl6Iop1tuj5jeO5FHmn+q7s+BX4L92w0g2GHX9L9KxvW6XPXoxpa/Rmj3l2sEfEOH6yf8hi6hn0IMhBgIMRBiIMRAiIEQAyEGvpGB/wVu1jPNvTQkkQAAAABJRU5ErkJggg=='
  };
  function announce() {
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: Object.freeze({ info, provider })
    }));
  }
  window.addEventListener('eip6963:requestProvider', announce);
  announce();

  // Also set window.ethereum if nothing else claimed it (last-resort compatibility).
  try { if (!window.ethereum) window.ethereum = provider; } catch (_) {}
})();
