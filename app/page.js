"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";

const DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const DAY_SHORT = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
const MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
const CATEGORIES = [
  { name: "עבודה", tone: "blue" },
  { name: "לימודים", tone: "violet" },
  { name: "אימון", tone: "green" },
  { name: "סידורים", tone: "orange" },
  { name: "אישי", tone: "pink" },
];

const REMINDER_PRESETS = [
  { minutes: 5, label: "5 דקות" },
  { minutes: 15, label: "15 דקות" },
  { minutes: 30, label: "30 דקות" },
  { minutes: 60, label: "שעה" },
  { minutes: 1440, label: "יום" },
];

function emptyEventForm(date = "") {
  return {
    title: "", date, start: "09:00", end: "10:00", category: "אישי", notes: "",
    reminderEnabled: false, reminderMinutesList: [], reminderCustomValue: "30", reminderCustomUnit: "minutes",
  };
}

function normalizeReminderMinutesList(values) {
  const source = Array.isArray(values) ? values : values ? [values] : [];
  return [...new Set(source.map(Number).filter((value) => Number.isInteger(value) && value > 0 && value <= 43200))]
    .sort((a, b) => b - a);
}

function reminderFormState(minutesList, fallbackMinutes) {
  const reminders = normalizeReminderMinutesList(
    Array.isArray(minutesList) && minutesList.length ? minutesList : fallbackMinutes
  );
  return {
    reminderEnabled: reminders.length > 0,
    reminderMinutesList: reminders,
    reminderCustomValue: "30",
    reminderCustomUnit: "minutes",
  };
}

function reminderMinutesListFromForm(form) {
  if (!form.reminderEnabled) return [];
  return normalizeReminderMinutesList(form.reminderMinutesList);
}

function customReminderMinutesFromForm(form) {
  const value = Number(form.reminderCustomValue);
  const multiplier = form.reminderCustomUnit === "days" ? 1440 : form.reminderCustomUnit === "hours" ? 60 : 1;
  const minutes = Math.round(value * multiplier);
  return Number.isFinite(value) && value > 0 && minutes <= 43200 ? minutes : NaN;
}

function reminderLabel(minutesBefore) {
  const value = Number(minutesBefore);
  if (value === 1440) return "יום לפני";
  if (value > 0 && value % 1440 === 0) return `${value / 1440} ימים לפני`;
  if (value === 60) return "שעה לפני";
  if (value > 0 && value % 60 === 0) return `${value / 60} שעות לפני`;
  return `${value} דקות לפני`;
}

function localISO(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function fromISO(value) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

function addDays(value, amount) {
  const date = typeof value === "string" ? fromISO(value) : new Date(value);
  date.setDate(date.getDate() + amount);
  return date;
}

function startOfWeek(value) {
  const date = typeof value === "string" ? fromISO(value) : new Date(value);
  date.setDate(date.getDate() - date.getDay());
  return date;
}

function weekDates(value) {
  const start = startOfWeek(value);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

function formatWeek(value) {
  const dates = weekDates(value);
  const first = dates[0];
  const last = dates[6];
  if (first.getMonth() === last.getMonth()) {
    return `${first.getDate()}–${last.getDate()} ${MONTHS[last.getMonth()]}`;
  }
  return `${first.getDate()} ${MONTHS[first.getMonth()]} – ${last.getDate()} ${MONTHS[last.getMonth()]}`;
}

function minutes(value) {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

function durationLabel(start, end) {
  const total = Math.max(0, minutes(end) - minutes(start));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (!hours) return `${mins} דק׳`;
  if (!mins) return `${hours} ש׳`;
  return `${hours}:${String(mins).padStart(2, "0")} ש׳`;
}

function totalDuration(events) {
  const total = events.reduce((sum, event) => sum + Math.max(0, minutes(event.end) - minutes(event.start)), 0);
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return `${hours}:${String(mins).padStart(2, "0")}`;
}

function eventEndTimestamp(event) {
  const [year, month, day] = event.date.split("-").map(Number);
  const [hour, minute] = event.end.split(":").map(Number);
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

function isEventPast(event, now) {
  return Boolean(now && eventEndTimestamp(event) <= now);
}

function toneFor(category) {
  return CATEGORIES.find((item) => item.name === category)?.tone || "pink";
}

function Icon({ name, size = 22 }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };
  if (name === "today") return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/><path d="M8 14h3v3H8z"/></svg>;
  if (name === "week") return <svg {...common}><rect x="3" y="4" width="18" height="17" rx="3"/><path d="M8 2v4M16 2v4M3 9h18M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01M16 17h.01"/></svg>;
  if (name === "plus") return <svg {...common}><path d="M12 5v14M5 12h14"/></svg>;
  if (name === "menu") return <svg {...common}><path d="M4 7h16M4 12h16M4 17h16"/></svg>;
  if (name === "back") return <svg {...common}><path d="m9 18 6-6-6-6"/></svg>;
  if (name === "forward") return <svg {...common}><path d="m15 18-6-6 6-6"/></svg>;
  if (name === "clock") return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>;
  if (name === "bell") return <svg {...common}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>;
  if (name === "edit") return <svg {...common}><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>;
  if (name === "trash") return <svg {...common}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 10v6M14 10v6"/></svg>;
  if (name === "moon") return <svg {...common}><path d="M20 15.2A8.5 8.5 0 0 1 8.8 4 8.5 8.5 0 1 0 20 15.2Z"/></svg>;
  if (name === "sun") return <svg {...common}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>;
  return null;
}

export default function Home() {
  const { data: session, status } = useSession();
  const [today, setToday] = useState("");
  const [anchor, setAnchor] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [view, setView] = useState("today");
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState("system");
  const [editing, setEditing] = useState(null);
  const [toast, setToast] = useState("");
  const [telegramStatus, setTelegramStatus] = useState(null);
  const [telegramBusy, setTelegramBusy] = useState(false);
  const [form, setForm] = useState(emptyEventForm());

  useEffect(() => {
    const currentDate = new Date();
    const current = localISO(currentDate);
    setToday(current);
    setAnchor(current);
    setSelectedDate(current);
    setForm((prev) => ({ ...prev, date: current }));
    const savedTheme = localStorage.getItem("schedule-theme") || "system";
    setTheme(savedTheme);

    const clock = window.setInterval(() => {
      const next = new Date();
      setToday(localISO(next));
    }, 30000);

    return () => window.clearInterval(clock);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("schedule-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!menuOpen || !session) return;
    let cancelled = false;
    fetch("/api/telegram/connect", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (!cancelled && data) setTelegramStatus(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [menuOpen, session]);

  async function loadWeek(date = anchor, { silent = false } = {}) {
    if (!date || !session) return;
    if (!silent) setLoading(true);
    try {
      const response = await fetch(`/api/events?week=${encodeURIComponent(date)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("load");
      const data = await response.json();
      setEvents(data.events || []);
    } catch {
      if (!silent) showToast("לא הצלחתי לטעון את השבוע");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    if (session && anchor) loadWeek(anchor);
  }, [session, anchor]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!session || !anchor) return;
    let lastSyncAt = Date.now();

    const syncOnReturn = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastSyncAt < 1500) return;
      lastSyncAt = now;
      loadWeek(anchor, { silent: true });
    };

    window.addEventListener("focus", syncOnReturn);
    document.addEventListener("visibilitychange", syncOnReturn);
    return () => {
      window.removeEventListener("focus", syncOnReturn);
      document.removeEventListener("visibilitychange", syncOnReturn);
    };
  }, [session, anchor]); // eslint-disable-line react-hooks/exhaustive-deps

  function showToast(message) {
    setToast(message);
    window.clearTimeout(window.__scheduleToast);
    window.__scheduleToast = window.setTimeout(() => setToast(""), 2600);
  }

  const dates = useMemo(() => (anchor ? weekDates(anchor) : []), [anchor]);
  const selectedEvents = useMemo(
    () => events.filter((event) => event.date === selectedDate).sort((a, b) => a.start.localeCompare(b.start)),
    [events, selectedDate]
  );
  const todayEvents = useMemo(
    () => events.filter((event) => event.date === today).sort((a, b) => a.start.localeCompare(b.start)),
    [events, today]
  );

  function navigateWeek(direction) {
    const next = localISO(addDays(startOfWeek(anchor), direction * 7));
    setAnchor(next);
    const nextSelected = localISO(addDays(startOfWeek(next), Math.min(fromISO(selectedDate || next).getDay(), 6)));
    setSelectedDate(nextSelected);
  }

  function openAdd(date = selectedDate || today) {
    setEditing(null);
    setForm(emptyEventForm(date));
    setView("add");
  }

  function openEdit(event) {
    setEditing(event);
    setForm({
      ...emptyEventForm(event.date),
      title: event.title,
      date: event.date,
      start: event.start,
      end: event.end,
      category: event.category,
      notes: event.notes || "",
      ...reminderFormState(event.reminderMinutesList, event.reminderMinutes),
    });
    setView("add");
  }

  async function saveEvent(event) {
    event.preventDefault();
    if (!form.title.trim()) return showToast("צריך לתת שם לאירוע");
    if (form.end <= form.start) return showToast("שעת הסיום צריכה להיות אחרי ההתחלה");
    const reminderMinutesList = reminderMinutesListFromForm(form);
    const payload = {
      title: form.title,
      date: form.date,
      start: form.start,
      end: form.end,
      category: form.category,
      notes: form.notes,
      reminderMinutesList,
    };
    setSaving(true);
    try {
      const response = await fetch(editing ? `/api/events/${editing.id}` : "/api/events", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing ? { ...payload, previousDate: editing.date } : payload),
      });
      if (!response.ok) throw new Error("save");
      const data = await response.json();
      const saved = data.event;
      const currentWeekStart = localISO(startOfWeek(anchor));
      const savedWeekStart = localISO(startOfWeek(saved.date));
      if (currentWeekStart !== savedWeekStart) setAnchor(saved.date);
      else await loadWeek(anchor);
      setSelectedDate(saved.date);
      setView("week");
      setEditing(null);
      showToast(editing ? "האירוע עודכן" : "האירוע נוסף");
    } catch {
      showToast("השמירה נכשלה");
    } finally {
      setSaving(false);
    }
  }

  async function connectTelegram() {
    setTelegramBusy(true);
    try {
      const response = await fetch("/api/telegram/connect", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "החיבור נכשל");
      setTelegramStatus((prev) => ({ ...(prev || {}), connected: true, botConfigured: true, reminderServiceConfigured: true }));
      showToast("Telegram מחובר ✓");
    } catch (error) {
      showToast(error.message || "החיבור לטלגרם נכשל");
    } finally {
      setTelegramBusy(false);
    }
  }

  async function removeEvent(event) {
    if (!window.confirm(`למחוק את “${event.title}”?`)) return;
    try {
      const response = await fetch(`/api/events/${event.id}?date=${encodeURIComponent(event.date)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("delete");
      await loadWeek(anchor);
      showToast("האירוע נמחק");
    } catch {
      showToast("המחיקה נכשלה");
    }
  }

  if (status === "loading" || !today) {
    return <main className="splash"><div className="brandMark"><Icon name="week" size={30}/></div><div className="loader"/></main>;
  }

  if (!session) {
    return (
      <main className="loginPage">
        <section className="loginCard">
          <div className="brandMark large"><Icon name="week" size={34}/></div>
          <h1>הלו״ז שלי</h1>
          <p>שבוע מסודר, בלי רעש מסביב.</p>
          <button className="primaryButton" onClick={() => signIn("google")}>
            התחברות עם Google
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="appShell">
      <header className="topBar">
        <button className="iconButton" onClick={() => setMenuOpen(true)} aria-label="פתיחת תפריט"><Icon name="menu"/></button>
        <div className="titleWrap">
          <strong>{view === "today" ? "היום" : view === "week" ? "השבוע שלי" : editing ? "עריכת אירוע" : "אירוע חדש"}</strong>
          {view !== "add" && <span>{formatWeek(anchor)}</span>}
        </div>
        <div className="topSpacer" />
      </header>

      {view !== "add" && (
        <section className="weekNavigator">
          <button onClick={() => navigateWeek(-1)} aria-label="שבוע קודם"><Icon name="back" size={19}/></button>
          <button className="weekLabel" onClick={() => { setAnchor(today); setSelectedDate(today); }}>
            {localISO(startOfWeek(anchor)) === localISO(startOfWeek(today)) ? "השבוע" : formatWeek(anchor)}
          </button>
          <button onClick={() => navigateWeek(1)} aria-label="שבוע הבא"><Icon name="forward" size={19}/></button>
        </section>
      )}

      <section className="content">
        {view === "today" && (
          <TodayView
            today={today}
            events={todayEvents}
            loading={loading}
            onAdd={() => openAdd(today)}
            onEdit={openEdit}
            onDelete={removeEvent}
          />
        )}

        {view === "week" && (
          <WeekView
            dates={dates}
            today={today}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            events={selectedEvents}
            allEvents={events}
            loading={loading}
            onAdd={() => openAdd(selectedDate)}
            onEdit={openEdit}
            onDelete={removeEvent}
            onNavigateWeek={navigateWeek}
          />
        )}

        {view === "add" && (
          <EventForm
            form={form}
            setForm={setForm}
            editing={editing}
            saving={saving}
            onSubmit={saveEvent}
            onCancel={() => { setEditing(null); setView("week"); }}
          />
        )}
      </section>

      <nav className="bottomNav" aria-label="ניווט ראשי">
        <button className={view === "today" ? "active" : ""} onClick={() => { setView("today"); setAnchor(today); setSelectedDate(today); }}><Icon name="today"/><span>היום</span></button>
        <button className={view === "week" ? "active" : ""} onClick={() => setView("week")}><Icon name="week"/><span>שבוע</span></button>
        <button className={view === "add" ? "active addNav" : "addNav"} onClick={() => openAdd()}><Icon name="plus"/><span>הוספה</span></button>
      </nav>

      {menuOpen && (
        <div className="drawerBackdrop" onMouseDown={() => setMenuOpen(false)}>
          <aside className="drawer" onMouseDown={(e) => e.stopPropagation()}>
            <div className="drawerHeader"><strong>הגדרות</strong><button className="closeButton" onClick={() => setMenuOpen(false)}>×</button></div>
            <div className="accountBox"><span>{session.user?.name || "החשבון שלי"}</span><small>{session.user?.email}</small></div>
            <div className="settingGroup">
              <label>מראה</label>
              <div className="segmented">
                <button className={theme === "system" ? "selected" : ""} onClick={() => setTheme("system")}>מערכת</button>
                <button className={theme === "light" ? "selected" : ""} onClick={() => setTheme("light")}><Icon name="sun" size={16}/>בהיר</button>
                <button className={theme === "dark" ? "selected" : ""} onClick={() => setTheme("dark")}><Icon name="moon" size={16}/>כהה</button>
              </div>
            </div>
            <div className="sheetNote"><strong>Google Sheets</strong><span>קובץ אחד קבוע ב-Drive. כל שבוע נשמר בו בטאב נפרד, מראשון עד שבת.</span></div>
            <div className="telegramBox">
              <div className="telegramTitle"><Icon name="bell" size={18}/><strong>תזכורות Telegram</strong></div>
              <span>{telegramStatus?.connected ? "מחובר. תזכורות פעילות לאירועים שבחרת." : "שלח /start לבוט שלך ואז לחץ על חיבור."}</span>
              <button type="button" onClick={connectTelegram} disabled={telegramBusy}>{telegramBusy ? "מחבר..." : telegramStatus?.connected ? "חבר מחדש" : "חבר Telegram"}</button>
            </div>
            <button className="logoutButton" onClick={() => signOut()}>התנתקות</button>
          </aside>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}

function TodayView({ today, events, loading, onAdd, onEdit, onDelete }) {
  const date = fromISO(today);
  return (
    <div className="viewStack">
      <section className="heroCard">
        <div><span className="eyebrow">{DAY_NAMES[date.getDay()]}</span><h2>{date.getDate()} {MONTHS[date.getMonth()]}</h2></div>
        <div className="heroStat"><strong>{events.length}</strong><span>אירועים</span></div>
        <div className="heroStat"><strong>{totalDuration(events)}</strong><span>שעות מתוזמנות</span></div>
      </section>
      <section className="sectionHeader"><div><h3>הלוח להיום</h3><p>{events.length ? "הכול במקום אחד" : "היום עדיין פתוח"}</p></div><button className="smallAdd" onClick={onAdd}><Icon name="plus" size={18}/>אירוע</button></section>
      <EventList events={events} loading={loading} onEdit={onEdit} onDelete={onDelete} emptyText="אין לך אירועים להיום." onAdd={onAdd}/>
    </div>
  );
}

function WeekView({ dates, today, selectedDate, setSelectedDate, events, allEvents, loading, onAdd, onEdit, onDelete, onNavigateWeek }) {
  const swipeStart = useRef(null);
  const swipeTimer = useRef(null);
  const suppressDayClick = useRef(false);
  const [stripOffset, setStripOffset] = useState(0);
  const [stripOpacity, setStripOpacity] = useState(1);
  const [stripAnimating, setStripAnimating] = useState(false);

  useEffect(() => () => window.clearTimeout(swipeTimer.current), []);

  function handleSwipeStart(event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    window.clearTimeout(swipeTimer.current);
    swipeStart.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, dragging: false };
    suppressDayClick.current = false;
    setStripAnimating(false);
  }

  function handleSwipeMove(event) {
    const start = swipeStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;

    if (!start.dragging) {
      if (Math.abs(dx) < 7 && Math.abs(dy) < 7) return;
      if (Math.abs(dy) > Math.abs(dx)) {
        swipeStart.current = null;
        setStripOffset(0);
        return;
      }
      start.dragging = true;
      suppressDayClick.current = true;
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }

    setStripOffset(Math.max(-110, Math.min(110, dx)));
    setStripOpacity(Math.max(0.72, 1 - Math.abs(dx) / 420));
  }

  function finishSwipe(event, cancelled = false) {
    const start = swipeStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const shouldNavigate = !cancelled && start.dragging && Math.abs(dx) >= 45;
    swipeStart.current = null;
    setStripAnimating(true);

    if (!shouldNavigate) {
      setStripOffset(0);
      setStripOpacity(1);
      swipeTimer.current = window.setTimeout(() => { suppressDayClick.current = false; }, 180);
      return;
    }

    // לפי הכיוון שביקשת: ימינה = השבוע הבא, שמאלה = השבוע הקודם.
    const direction = dx > 0 ? 1 : -1;
    const exitOffset = dx > 0 ? 82 : -82;
    const enterOffset = dx > 0 ? -82 : 82;
    setStripOffset(exitOffset);
    setStripOpacity(0.15);

    swipeTimer.current = window.setTimeout(() => {
      onNavigateWeek(direction);
      setStripAnimating(false);
      setStripOffset(enterOffset);
      setStripOpacity(0.15);

      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          setStripAnimating(true);
          setStripOffset(0);
          setStripOpacity(1);
          swipeTimer.current = window.setTimeout(() => { suppressDayClick.current = false; }, 220);
        });
      });
    }, 150);
  }

  return (
    <div className="viewStack">
      <section
        className="dayStripViewport"
        onPointerDown={handleSwipeStart}
        onPointerMove={handleSwipeMove}
        onPointerUp={(event) => finishSwipe(event)}
        onPointerCancel={(event) => finishSwipe(event, true)}
        onClickCapture={(event) => {
          if (suppressDayClick.current) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        <div
          className={`dayStrip ${stripAnimating ? "swipeAnimating" : ""}`}
          style={{ transform: `translate3d(${stripOffset}px, 0, 0)`, opacity: stripOpacity }}
        >
          {dates.map((date, index) => {
            const iso = localISO(date);
            const count = allEvents.filter((event) => event.date === iso).length;
            return (
              <button key={iso} className={`${selectedDate === iso ? "selected" : ""} ${today === iso ? "today" : ""}`} onClick={() => setSelectedDate(iso)}>
                <span>{DAY_SHORT[index]}</span><strong>{date.getDate()}</strong><i className={count ? "hasEvents" : ""}/>
              </button>
            );
          })}
        </div>
      </section>
      <section className="weekSummary">
        <div><span>השבוע</span><strong>{allEvents.length} אירועים</strong></div>
        <div><span>סה״כ מתוזמן</span><strong>{totalDuration(allEvents)} שעות</strong></div>
      </section>
      <section className="sectionHeader"><div><h3>{DAY_NAMES[fromISO(selectedDate).getDay()]}</h3><p>{fromISO(selectedDate).getDate()} {MONTHS[fromISO(selectedDate).getMonth()]}</p></div><button className="smallAdd" onClick={onAdd}><Icon name="plus" size={18}/>אירוע</button></section>
      <EventList events={events} loading={loading} onEdit={onEdit} onDelete={onDelete} emptyText="אין אירועים ביום הזה." onAdd={onAdd}/>
    </div>
  );
}

function EventList({ events, loading, onEdit, onDelete, emptyText, onAdd }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(clock);
  }, []);

  if (loading) return <div className="loadingList"><div/><div/><div/></div>;
  if (!events.length) return <div className="emptyState"><div className="emptyIcon"><Icon name="clock" size={28}/></div><strong>{emptyText}</strong><span>אפשר להשאיר אותו פנוי או להוסיף משהו.</span><button onClick={onAdd}>הוסף אירוע</button></div>;
  return <div className="eventList">{events.map((event) => <EventCard key={event.id} event={event} now={now} onEdit={onEdit} onDelete={onDelete}/>)}</div>;
}

function EventCard({ event, now, onEdit, onDelete }) {
  const completed = isEventPast(event, now);
  return (
    <article className={`eventCard tone-${toneFor(event.category)} ${completed ? "eventCompleted" : ""}`}>
      <div className="eventAccent"/>
      <div className="eventTime"><strong>{event.start}</strong><span>{event.end}</span></div>
      <div className="eventInfo"><div className="eventTitleRow"><h4>{event.title}</h4><span className="categoryPill">{event.category}</span>{completed && <span className="completedPill">הסתיים</span>}</div><p>{event.notes || durationLabel(event.start, event.end)}</p>{(event.reminderMinutesList?.length || event.reminderMinutes) ? <div className="reminderMeta"><Icon name="bell" size={13}/><span>{normalizeReminderMinutesList(event.reminderMinutesList?.length ? event.reminderMinutesList : event.reminderMinutes).map(reminderLabel).join(" · ")}</span></div> : null}</div>
      <div className="eventActions"><button onClick={() => onEdit(event)} aria-label="עריכה"><Icon name="edit" size={18}/></button><button onClick={() => onDelete(event)} aria-label="מחיקה"><Icon name="trash" size={18}/></button></div>
    </article>
  );
}

function EventForm({ form, setForm, editing, saving, onSubmit, onCancel }) {
  function update(key, value) { setForm((prev) => ({ ...prev, [key]: value })); }
  return (
    <form className="eventForm" onSubmit={onSubmit}>
      <section className="formCard">
        <label className="field full"><span>מה בתכנון?</span><input autoFocus value={form.title} onChange={(e) => update("title", e.target.value)} placeholder="למשל: עבודה, למידה למבחן..."/></label>
        <label className="field full"><span>תאריך</span><input type="date" value={form.date} onChange={(e) => update("date", e.target.value)}/></label>
        <div className="timeGrid">
          <label className="field"><span>שעת התחלה</span><input type="time" value={form.start} onChange={(e) => update("start", e.target.value)}/></label>
          <label className="field"><span>שעת סיום</span><input type="time" value={form.end} onChange={(e) => update("end", e.target.value)}/></label>
        </div>
        <div className="durationPreview"><Icon name="clock" size={17}/><span>{form.end > form.start ? `משך האירוע: ${durationLabel(form.start, form.end)}` : "שעת הסיום צריכה להיות אחרי ההתחלה"}</span></div>
      </section>

      <section className="formCard reminderFormCard">
        <div className="reminderHeader">
          <div><span className="fieldLabel">תזכורת Telegram</span><small>לקבל הודעה לפני תחילת האירוע</small></div>
          <button type="button" role="switch" aria-checked={form.reminderEnabled} className={`reminderSwitch ${form.reminderEnabled ? "on" : ""}`} onClick={() => setForm((prev) => ({ ...prev, reminderEnabled: !prev.reminderEnabled, reminderMinutesList: !prev.reminderEnabled && prev.reminderMinutesList.length === 0 ? [15] : prev.reminderMinutesList }))}><i/></button>
        </div>
        {form.reminderEnabled && (
          <div className="reminderSettings">
            <div className="reminderHint">אפשר לבחור כמה תזכורות לאותו אירוע</div>
            <div className="reminderOptions">
              {REMINDER_PRESETS.map((preset) => {
                const selected = form.reminderMinutesList.includes(preset.minutes);
                return <button type="button" key={preset.minutes} className={selected ? "selected" : ""} onClick={() => setForm((prev) => ({ ...prev, reminderMinutesList: selected ? prev.reminderMinutesList.filter((value) => value !== preset.minutes) : normalizeReminderMinutesList([...prev.reminderMinutesList, preset.minutes]) }))}>{preset.label}</button>;
              })}
            </div>
            <div className="customReminder">
              <label className="field"><span>תזכורת מותאמת</span><input type="number" inputMode="decimal" min="1" value={form.reminderCustomValue} onChange={(e) => update("reminderCustomValue", e.target.value)}/></label>
              <label className="field"><span>יחידה</span><select value={form.reminderCustomUnit} onChange={(e) => update("reminderCustomUnit", e.target.value)}><option value="minutes">דקות</option><option value="hours">שעות</option><option value="days">ימים</option></select></label>
              <button type="button" className="addReminderButton" onClick={() => {
                const minutes = customReminderMinutesFromForm(form);
                if (Number.isNaN(minutes)) return;
                setForm((prev) => ({ ...prev, reminderMinutesList: normalizeReminderMinutesList([...prev.reminderMinutesList, minutes]) }));
              }}>+ הוסף תזכורת</button>
            </div>
            {form.reminderMinutesList.length > 0 ? (
              <div className="selectedReminders">
                {form.reminderMinutesList.map((minutes) => <button type="button" key={minutes} onClick={() => setForm((prev) => ({ ...prev, reminderMinutesList: prev.reminderMinutesList.filter((value) => value !== minutes) }))}><Icon name="bell" size={14}/><span>{reminderLabel(minutes)}</span><b>×</b></button>)}
              </div>
            ) : <div className="reminderPreview"><Icon name="bell" size={15}/><span>עדיין לא נבחרה תזכורת</span></div>}
          </div>
        )}
      </section>

      <section className="formCard">
        <div className="field full"><span>קטגוריה</span><div className="categoryGrid">{CATEGORIES.map((category) => <button type="button" key={category.name} className={`${form.category === category.name ? "selected" : ""} tone-${category.tone}`} onClick={() => update("category", category.name)}><i/>{category.name}</button>)}</div></div>
        <label className="field full"><span>הערה <em>אופציונלי</em></span><textarea rows="3" value={form.notes} onChange={(e) => update("notes", e.target.value)} placeholder="משהו שכדאי לזכור..."/></label>
      </section>

      <div className="formActions"><button type="button" className="secondaryButton" onClick={onCancel}>ביטול</button><button className="primaryButton" disabled={saving}>{saving ? "שומר..." : editing ? "שמור שינויים" : "שמור אירוע"}</button></div>
    </form>
  );
}
