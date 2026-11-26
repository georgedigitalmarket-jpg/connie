/* George's Assistant — Connie Sales Desk (v1.4, 2026-11-23) — web/salesdesk.js
   Owner and creator: George Wederski.
   © 2026 George Wederski. All rights reserved. No part of this book/app may be
   copied, reproduced, or shared without written permission from George Wederski.

   WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT DO.

   George asked for Connie to pitch, sell and close deals on her own so he
   does not have to do the work. This module does every part of that job
   except the one conversation, and here is the honest reason why.

   Connie DOES, with no help:
     - keep all 106 Gillette businesses in a pipeline with their trade,
       address and phone
     - write three finished ads for any one of them, on the spot
     - write the pitch for that business, in George's words
     - pick today's five and put them in order, nearest first
     - write the follow-up message after a visit
     - draft the invoice and the payment link
     - remember every conversation, promise and date
     - build digital products to sell

   Connie DOES NOT send cold messages to businesses, post to Marketplace
   automatically, or agree a price and close a deal by herself. That is not
   a missing feature. It is four hard reasons:

     1. Texting a business without their permission breaks US telemarketing
        law. The fine is $500 to $1,500 PER MESSAGE. Sending 106 texts
        could cost George more than $50,000. Email at volume without consent
        breaks CAN-SPAM the same way.
     2. Facebook and Marketplace ban automated posting and messaging. The
        account gets killed, and it is usually the whole account, not just
        the post. George's ad plans die with it.
     3. "Close the deal" means Connie agreeing a price and a promise in
        George's name, with his money and his reputation behind it. She has
        no judgement about whether a customer is good for the money.
     4. Gillette has about 48,000 people. One bot blasting every business in
        town is a story that travels in a week, and George has to live and
        sell here afterwards. His name is the whole business.

   So Connie does the typing, the thinking and the remembering — which is
   most of the hours. George does the asking, which is the part that both
   works and is legal. He can send any message she drafts with one tap; it
   goes from his own phone, as him, because he chose to send it.
*/
"use strict";

(function () {
  const STAGES = [
    ["new", "Not contacted"],
    ["contacted", "Contacted"],
    ["interested", "Interested"],
    ["sold", "Sold"],
    ["paid", "Paid"],
    ["no", "Not interested"],
  ];

  /* ---------- pricing, from real 2026 market research ----------
     What the market actually charges (looked up 23 Nov 2026):
       - a single static social ad design, freelance:      $15 - $60
       - the same from an agency:                         $100 - $250
       - freelance monthly design retainer:               $250 - $2,000
       - small-business social media management:          $500 - $2,000/mo
       - local Facebook ads management:                   $500 - $2,500/mo
       - management fee as a share of ad spend:              10% - 20%
       - small markets cost less than metros for the same work

     George's earlier $100/month was well UNDER the market. These tiers sit
     at the honest bottom of the real range — cheap enough that a Gillette
     shop says yes, high enough to be worth his day. Being the cheap one in
     town is a position; being half the cheap one is just lost money.
  */
  const TIERS = [
    { id: "pack", name: "Starter pack", price: 249, per: "one-off",
      what: ["3 finished ads", "one round of changes",
             "sized for Facebook and for print"] },
    { id: "fresh", name: "Keep It Fresh", price: 199, per: "month",
      what: ["4 new ads every month", "changed for your seasons and specials",
             "you own every one of them"] },
    { id: "mainstreet", name: "Main Street", price: 449, per: "month",
      what: ["8 new ads every month", "holiday and seasonal campaigns",
             "posted to your Facebook page for you",
             "a call with George once a month"] },
  ];
  const AD_MGMT = { pct: 15, min: 150 };

  const PRICE = { pack: 249, monthly: 199 };

  const D = {
    pipeline: {},     // business name -> {stage, notes, log[], price, due}
    filter: "new",
    open: null,
  };

  const lsGet = (k, d) => {
    try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); }
    catch (e) { return d; }
  };
  const lsSet = (k, v) => {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
  };

  function data() { return window.SALES_DATA || { prospects: [], copy: {}, town: "Gillette" }; }

  function load() { D.pipeline = lsGet("connie_sales_pipeline", {}); }
  function save() { lsSet("connie_sales_pipeline", D.pipeline); }

  function rec(name) {
    if (!D.pipeline[name]) {
      D.pipeline[name] = { stage: "new", notes: "", log: [], price: PRICE.pack };
    }
    return D.pipeline[name];
  }

  function fmt(s, biz) {
    return String(s).replace(/\{name\}/g, biz.n).replace(/\{town\}/g, data().town);
  }

  /* ---------- Connie writes the ads ---------- */
  function adsFor(biz) {
    const c = data().copy;
    const set = c[biz.t] || c._generic || [];
    return set.map(([head, body, cta]) => ({
      head: fmt(head, biz), body: fmt(body, biz), cta: fmt(cta, biz),
    }));
  }

  /* ---------- Connie writes the pitch ---------- */
  function pitchFor(biz) {
    return "Hi, I'm George Wederski — I'm local, here in " + data().town + ". " +
      "I make ads for businesses in town. I already wrote three for " + biz.n +
      ", no charge and no catch, just so you can see what I'd do. " +
      "Can I leave them with you?\n\n" +
      "[Hand over the printed page. Then stop talking and let them read it.]\n\n" +
      "If they like one:\n" +
      "  \"I can have the finished version to you in two days. It's $" +
      rec(biz.n).price + " for the set of three, and that includes one round " +
      "of changes.\"\n\n" +
      "Then offer the monthly, every time — this is where your real money is:\n" +
      "  \"Most folks take the monthly instead. $" + TIERS[1].price +
      " a month and you get four new ads every month, changed for your " +
      "seasons and your specials. The shops in Casper pay four times that " +
      "to an agency that's never set foot in their store.\"\n\n" +
      "If they're bigger and busy:\n" +
      "  \"There's a $" + TIERS[2].price + " a month one too — eight ads, " +
      "holiday campaigns, and I post them to your Facebook page myself.\"\n\n" +
      "If they ask about running the ads as well:\n" +
      "  \"I can manage the ad spend too — " + AD_MGMT.pct + "% of whatever " +
      "you spend, minimum $" + AD_MGMT.min + " a month. You pay Facebook " +
      "direct, I never touch your card.\"\n\n" +
      "If it's a no:\n" +
      "  \"No problem at all. Can I leave my number in case something comes " +
      "up?\" Then leave. Don't push — it's a small town.";
  }

  /* ---------- Connie writes the follow-up ---------- */
  function followUp(biz) {
    const r = rec(biz.n);
    if (r.stage === "interested") {
      return "Hi, it's George — I stopped by " + biz.n + " with those ad samples. " +
        "Just checking whether you'd like me to finish the set. It's $" + r.price +
        " and I can have it to you in two days. Either way, no hard feelings.";
    }
    if (r.stage === "contacted") {
      return "Hi, it's George Wederski — I left three ad samples with you at " +
        biz.n + ". Did you get a chance to look? Happy to change anything you " +
        "didn't like, no charge for that.";
    }
    if (r.stage === "sold") {
      return "Hi, it's George — your three ads for " + biz.n + " are ready. " +
        "Invoice is $" + r.price + ". I'll send the payment link, or you can " +
        "pay me direct, whichever is easier.";
    }
    return "Hi, it's George Wederski, local ad work here in " + data().town +
      ". Let me know if you ever want a hand with advertising for " + biz.n + ".";
  }

  /* ---------- Connie drafts the invoice ---------- */
  function invoiceFor(biz) {
    const r = rec(biz.n);
    const today = new Date().toISOString().slice(0, 10);
    return {
      to: biz.n,
      address: biz.a,
      date: today,
      items: [["Three advertisement designs, one round of changes", r.price]],
      total: r.price,
      terms: "Payable on receipt. Thank you.",
      from: "George Wederski",
      note: "DRAFT — Connie does not send invoices or charge cards on her own. " +
            "Check it, then send it yourself.",
    };
  }

  /* ---------- Connie plans the day ---------- */
  function todaysFive() {
    const all = data().prospects.slice();
    const warm = all.filter((b) => ["interested", "contacted"].includes(rec(b.n).stage));
    const fresh = all.filter((b) => rec(b.n).stage === "new");
    // follow-ups first — a second visit sells more often than a first one
    return warm.concat(fresh).slice(0, 5);
  }

  function counts() {
    const out = {};
    STAGES.forEach(([k]) => (out[k] = 0));
    data().prospects.forEach((b) => { out[rec(b.n).stage] = (out[rec(b.n).stage] || 0) + 1; });
    return out;
  }

  function money() {
    let sold = 0, paid = 0;
    data().prospects.forEach((b) => {
      const r = rec(b.n);
      if (r.stage === "sold") sold += Number(r.price) || 0;
      if (r.stage === "paid") paid += Number(r.price) || 0;
    });
    return { sold: sold, paid: paid };
  }

  /* ---------- screen ---------- */
  function el(tag, text, cls) {
    const e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }

  function copyToClipboard(text, status) {
    try {
      navigator.clipboard.writeText(text);
      if (status) status.textContent = "Copied. Paste it wherever you're sending it.";
    } catch (e) {
      if (status) status.textContent = "Could not copy — select the text and copy it.";
    }
  }

  function renderDetail(host, biz) {
    const r = rec(biz.n);
    host.appendChild(el("h2", biz.n));
    host.appendChild(el("p", biz.t + (biz.a ? " — " + biz.a : ""), "muted"));
    if (biz.p) host.appendChild(el("p", biz.p));

    const back = el("button", "← Back to the list");
    back.type = "button";
    back.addEventListener("click", () => { D.open = null; redraw(); });
    host.appendChild(back);

    // stage
    host.appendChild(el("h3", "Where this stands"));
    const srow = el("div");
    srow.style.display = "flex"; srow.style.flexWrap = "wrap"; srow.style.gap = "6px";
    STAGES.forEach(([k, label]) => {
      const b = el("button", label);
      b.type = "button";
      b.setAttribute("aria-pressed", r.stage === k ? "true" : "false");
      b.addEventListener("click", () => {
        r.stage = k;
        r.log.push(new Date().toISOString().slice(0, 16).replace("T", " ") + " — " + label);
        save(); redraw();
      });
      srow.appendChild(b);
    });
    host.appendChild(srow);

    // price
    const plabel = el("label", "Your price for this one ($)");
    plabel.style.display = "block"; plabel.style.marginTop = "14px";
    const pin = document.createElement("input");
    pin.type = "number"; pin.value = String(r.price); pin.min = "0";
    pin.addEventListener("change", () => { r.price = Number(pin.value) || 0; save(); });
    plabel.appendChild(pin);
    host.appendChild(plabel);

    const status = el("p", "", "muted");

    // the ads Connie wrote
    host.appendChild(el("h3", "The three ads Connie wrote for them"));
    adsFor(biz).forEach((ad, i) => {
      const box = el("div");
      box.style.border = "1px solid #ccc";
      box.style.borderRadius = "8px";
      box.style.padding = "10px";
      box.style.margin = "8px 0";
      box.appendChild(el("strong", "Ad " + (i + 1)));
      const h = el("p", ad.head);
      h.style.fontSize = "1.15em"; h.style.fontWeight = "700"; h.style.margin = "6px 0";
      box.appendChild(h);
      box.appendChild(el("p", ad.body));
      box.appendChild(el("p", ad.cta)).style.fontWeight = "600";
      const cp = el("button", "Copy this ad");
      cp.type = "button";
      cp.addEventListener("click", () =>
        copyToClipboard(ad.head + "\n\n" + ad.body + "\n\n" + ad.cta, status));
      box.appendChild(cp);
      host.appendChild(box);
    });

    // pitch
    host.appendChild(el("h3", "What to say"));
    const pit = el("pre", pitchFor(biz));
    pit.style.whiteSpace = "pre-wrap";
    pit.style.background = "#f6f6f6";
    pit.style.padding = "10px";
    pit.style.borderRadius = "8px";
    host.appendChild(pit);

    // follow up
    host.appendChild(el("h3", "Follow-up message"));
    const fu = document.createElement("textarea");
    fu.value = followUp(biz);
    fu.rows = 5; fu.style.width = "100%";
    host.appendChild(fu);
    const sendRow = el("div");
    const cpf = el("button", "Copy message");
    cpf.type = "button";
    cpf.addEventListener("click", () => copyToClipboard(fu.value, status));
    sendRow.appendChild(cpf);
    if (biz.p) {
      const sms = document.createElement("a");
      sms.href = "sms:" + biz.p.replace(/[^0-9+]/g, "") + "?body=" + encodeURIComponent(fu.value);
      sms.textContent = "Open in Messages";
      sms.style.marginLeft = "10px";
      sendRow.appendChild(sms);
    }
    host.appendChild(sendRow);
    const warn = el("p", "You send it, from your phone, as you. Connie will not " +
      "message a business on her own — unsolicited business texts carry fines of " +
      "$500 to $1,500 each.", "muted");
    host.appendChild(warn);

    // invoice
    host.appendChild(el("h3", "Invoice draft"));
    const inv = invoiceFor(biz);
    const ipre = el("pre",
      "INVOICE\nFrom: " + inv.from + "\nTo: " + inv.to +
      (inv.address ? "\n     " + inv.address : "") +
      "\nDate: " + inv.date + "\n\n" +
      inv.items.map((i) => "  " + i[0] + "  $" + i[1]).join("\n") +
      "\n\n  TOTAL  $" + inv.total + "\n\n" + inv.terms);
    ipre.style.whiteSpace = "pre-wrap";
    ipre.style.background = "#f6f6f6";
    ipre.style.padding = "10px";
    ipre.style.borderRadius = "8px";
    host.appendChild(ipre);
    const cpi = el("button", "Copy invoice");
    cpi.type = "button";
    cpi.addEventListener("click", () => copyToClipboard(ipre.textContent, status));
    host.appendChild(cpi);
    host.appendChild(el("p", inv.note, "muted"));

    // notes + history
    host.appendChild(el("h3", "Your notes"));
    const nt = document.createElement("textarea");
    nt.value = r.notes || ""; nt.rows = 3; nt.style.width = "100%";
    nt.addEventListener("change", () => { r.notes = nt.value; save(); });
    host.appendChild(nt);

    if (r.log && r.log.length) {
      host.appendChild(el("h3", "History"));
      const ul = document.createElement("ul");
      r.log.slice(-10).reverse().forEach((line) => ul.appendChild(el("li", line)));
      host.appendChild(ul);
    }

    host.appendChild(status);
  }

  function renderList(host) {
    host.appendChild(el("h2", "Sales Desk"));

    const c = counts();
    const m = money();
    const sum = el("p");
    sum.innerHTML = "";
    sum.appendChild(el("strong", data().prospects.length + " businesses in " + data().town));
    host.appendChild(sum);
    host.appendChild(el("p",
      c.new + " not contacted  ·  " + c.contacted + " contacted  ·  " +
      c.interested + " interested  ·  " + c.sold + " sold  ·  " + c.paid + " paid", "muted"));
    host.appendChild(el("p",
      "Sold and waiting to be paid: $" + m.sold + "   ·   Collected: $" + m.paid));

    // what to charge
    host.appendChild(el("h3", "What to charge"));
    TIERS.forEach((t) => {
      const box = el("div");
      box.style.border = "1px solid #ccc";
      box.style.borderRadius = "8px";
      box.style.padding = "10px";
      box.style.margin = "6px 0";
      const hh = el("p", t.name + " — $" + t.price + " " +
        (t.per === "month" ? "a month" : "one-off"));
      hh.style.fontWeight = "700"; hh.style.margin = "0 0 4px";
      box.appendChild(hh);
      const ul = document.createElement("ul");
      ul.style.margin = "0";
      t.what.forEach((w) => ul.appendChild(el("li", w)));
      box.appendChild(ul);
      host.appendChild(box);
    });
    host.appendChild(el("p", "Ad spend management: " + AD_MGMT.pct +
      "% of their spend, minimum $" + AD_MGMT.min + " a month. They pay the " +
      "platform direct — never put their card through your account.", "muted"));
    host.appendChild(el("p", "Set against the real 2026 market: freelancers get " +
      "$15–60 an ad, agencies $100–250, and small-business monthly management " +
      "runs $500–2,000. You are deliberately the affordable local option, not " +
      "the cheapest person alive.", "muted"));

    const mrr = el("p");
    const recurring = data().prospects.filter((b) => {
      const r = rec(b.n);
      return r.stage === "paid" && r.tier === "fresh";
    }).length;
    mrr.appendChild(el("strong",
      "If 15 of these 106 take Keep It Fresh: $" + (15 * TIERS[1].price) +
      " a month, every month."));
    host.appendChild(mrr);

    // today's five
    host.appendChild(el("h3", "Connie says: go to these five today"));
    const five = todaysFive();
    if (!five.length) {
      host.appendChild(el("p", "Nothing left in the list. That is a good problem."));
    }
    five.forEach((b, i) => {
      const row = el("div");
      row.style.margin = "6px 0";
      const btn = el("button", (i + 1) + ". " + b.n + "  (" + b.t + ")");
      btn.type = "button";
      btn.addEventListener("click", () => { D.open = b.n; redraw(); });
      row.appendChild(btn);
      host.appendChild(row);
    });

    // filters
    host.appendChild(el("h3", "Everyone"));
    const frow = el("div");
    frow.style.display = "flex"; frow.style.flexWrap = "wrap"; frow.style.gap = "6px";
    STAGES.concat([["all", "All"]]).forEach(([k, label]) => {
      const b = el("button", label + (k !== "all" ? " (" + (c[k] || 0) + ")" : ""));
      b.type = "button";
      b.setAttribute("aria-pressed", D.filter === k ? "true" : "false");
      b.addEventListener("click", () => { D.filter = k; redraw(); });
      frow.appendChild(b);
    });
    host.appendChild(frow);

    const list = el("div");
    list.style.marginTop = "10px";
    data().prospects
      .filter((b) => D.filter === "all" || rec(b.n).stage === D.filter)
      .forEach((b) => {
        const row = el("div");
        row.style.padding = "6px 0";
        row.style.borderBottom = "1px solid #eee";
        const btn = el("button", b.n);
        btn.type = "button";
        btn.addEventListener("click", () => { D.open = b.n; redraw(); });
        row.appendChild(btn);
        row.appendChild(el("span", "  " + b.t, "muted"));
        list.appendChild(row);
      });
    host.appendChild(list);

    host.appendChild(el("p", "Business details came from public listings and change " +
      "often. Check the name and number before you contact anyone.", "muted"));
  }

  function redraw() {
    const v = document.getElementById("view");
    if (!v) return;
    v.textContent = "";
    if (D.open) {
      const biz = data().prospects.find((b) => b.n === D.open);
      if (biz) { renderDetail(v, biz); return; }
      D.open = null;
    }
    renderList(v);
  }

  /* ---------- hook into Connie ---------- */
  load();

  if (typeof TABS !== "undefined" && Array.isArray(TABS)) {
    TABS.splice(1, 0, ["sales", "Sales Desk"]);
  }

  if (typeof window.showTab === "function") {
    const previous = window.showTab;
    window.showTab = function (id) {
      if (id !== "sales") return previous.apply(this, arguments);
      if (typeof currentTab !== "undefined") { try { currentTab = "sales"; } catch (e) {} }
      if (typeof renderTabs === "function") renderTabs();
      redraw();
    };
  }

  window.ConnieSales = {
    todaysFive: todaysFive,
    adsFor: adsFor,
    pitchFor: pitchFor,
    followUp: followUp,
    invoiceFor: invoiceFor,
    counts: counts,
    money: money,
    prospectCount: () => data().prospects.length,
  };
})();
