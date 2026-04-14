import { invoke } from "@tauri-apps/api/core";
import { sendNotification, isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";

interface Alarm {
  id: string;
  time: string;
  label: string;
  enabled: boolean;
  repeat_days: number[];
  ringtone: string;
}

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];
const RINGTONE_NAMES: Record<string, string> = {
  cute: "猫咪喵喵",
  bell: "经典铃声",
  chime: "清脆风铃",
  birds: "鸟鸣声"
};

class CuteAlarm {
  private alarms: Alarm[] = [];
  private editingAlarm: Alarm | null = null;
  private selectedDays: number[] = [];

  constructor() {
    this.init();
  }

  private async init() {
    this.bindEvents();
    this.updateClock();
    this.loadAlarms();
    this.startAlarmCheck();
    await this.requestNotificationPermission();

    // Update clock every second
    setInterval(() => this.updateClock(), 1000);

    // Check alarms every 30 seconds
    setInterval(() => this.checkAlarms(), 30000);
  }

  private bindEvents() {
    // Add button
    document.getElementById("addBtn")?.addEventListener("click", () => this.openModal());

    // Modal controls
    document.getElementById("closeModal")?.addEventListener("click", () => this.closeModal());
    document.getElementById("cancelBtn")?.addEventListener("click", () => this.closeModal());
    document.getElementById("saveBtn")?.addEventListener("click", () => this.saveAlarm());

    // Day buttons
    document.querySelectorAll(".day-btn").forEach(btn => {
      btn.addEventListener("click", () => this.toggleDay(parseInt(btn.getAttribute("data-day") || "0")));
    });

    // Ring modal dismiss
    document.getElementById("dismissBtn")?.addEventListener("click", () => this.dismissRing());

    // Close modal on backdrop click
    document.getElementById("alarmModal")?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) this.closeModal();
    });
  }

  private updateClock() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
    const dateStr = now.toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "long"
    });

    const timeEl = document.getElementById("currentTime");
    const dateEl = document.getElementById("currentDate");

    if (timeEl) timeEl.textContent = timeStr;
    if (dateEl) dateEl.textContent = dateStr;
  }

  private async loadAlarms() {
    try {
      this.alarms = await invoke<Alarm[]>("get_alarms");
      this.renderAlarms();
    } catch (e) {
      console.error("Failed to load alarms:", e);
    }
  }

  private renderAlarms() {
    const listEl = document.getElementById("alarmList");
    const emptyEl = document.getElementById("emptyState");

    if (!listEl) return;

    if (this.alarms.length === 0) {
      listEl.innerHTML = "";
      emptyEl?.classList.add("show");
      return;
    }

    emptyEl?.classList.remove("show");

    listEl.innerHTML = this.alarms.map(alarm => {
      const repeatText = alarm.repeat_days.length === 0
        ? "仅一次"
        : alarm.repeat_days.sort().map(d => WEEKDAYS[d]).join("、");

      const ringtoneText = RINGTONE_NAMES[alarm.ringtone] || "默认铃声";

      return `
        <div class="alarm-card ${alarm.enabled ? "" : "disabled"}" data-id="${alarm.id}">
          <div class="alarm-info">
            <div class="alarm-time">${alarm.time}</div>
            <div class="alarm-label">${alarm.label || "闹钟"}</div>
            <div class="alarm-repeat">${repeatText}</div>
            <div class="alarm-ringtone">${ringtoneText}</div>
          </div>
          <div class="alarm-actions">
            <button class="alarm-toggle ${alarm.enabled ? "active" : ""}" data-id="${alarm.id}"></button>
            <button class="delete-btn" data-id="${alarm.id}">🗑️</button>
          </div>
        </div>
      `;
    }).join("");

    // Bind events to new elements
    listEl.querySelectorAll(".alarm-card").forEach(card => {
      card.addEventListener("click", (e) => {
        const target = e.target as HTMLElement;
        if (!target.closest(".alarm-toggle") && !target.closest(".delete-btn")) {
          const id = card.getAttribute("data-id");
          if (id) this.editAlarm(id);
        }
      });
    });

    listEl.querySelectorAll(".alarm-toggle").forEach(toggle => {
      toggle.addEventListener("click", () => {
        const id = toggle.getAttribute("data-id");
        if (id) this.toggleAlarm(id);
      });
    });

    listEl.querySelectorAll(".delete-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        if (id) this.deleteAlarm(id);
      });
    });
  }

  private openModal(alarm?: Alarm) {
    const modal = document.getElementById("alarmModal");
    const title = document.getElementById("modalTitle");
    const timeInput = document.getElementById("alarmTime") as HTMLInputElement;
    const labelInput = document.getElementById("alarmLabel") as HTMLInputElement;
    const ringtoneSelect = document.getElementById("alarmRingtone") as HTMLSelectElement;

    if (!modal) return;

    this.editingAlarm = alarm || null;
    this.selectedDays = alarm?.repeat_days || [];

    if (title) title.textContent = alarm ? "编辑闹钟" : "添加闹钟";
    if (timeInput) timeInput.value = alarm?.time || "08:00";
    if (labelInput) labelInput.value = alarm?.label || "";
    if (ringtoneSelect) ringtoneSelect.value = alarm?.ringtone || "cute";

    // Update day buttons
    document.querySelectorAll(".day-btn").forEach(btn => {
      const day = parseInt(btn.getAttribute("data-day") || "0");
      btn.classList.toggle("selected", this.selectedDays.includes(day));
    });

    modal.classList.add("show");
  }

  private closeModal() {
    const modal = document.getElementById("alarmModal");
    modal?.classList.remove("show");
    this.editingAlarm = null;
    this.selectedDays = [];
  }

  private toggleDay(day: number) {
    const index = this.selectedDays.indexOf(day);
    if (index === -1) {
      this.selectedDays.push(day);
    } else {
      this.selectedDays.splice(index, 1);
    }

    document.querySelectorAll(".day-btn").forEach(btn => {
      const btnDay = parseInt(btn.getAttribute("data-day") || "0");
      btn.classList.toggle("selected", this.selectedDays.includes(btnDay));
    });
  }

  private async saveAlarm() {
    const timeInput = document.getElementById("alarmTime") as HTMLInputElement;
    const labelInput = document.getElementById("alarmLabel") as HTMLInputElement;
    const ringtoneSelect = document.getElementById("alarmRingtone") as HTMLSelectElement;

    if (!timeInput || !labelInput || !ringtoneSelect) return;

    const alarm: Alarm = {
      id: this.editingAlarm?.id || crypto.randomUUID(),
      time: timeInput.value,
      label: labelInput.value.trim() || "闹钟",
      enabled: this.editingAlarm?.enabled ?? true,
      repeat_days: [...this.selectedDays],
      ringtone: ringtoneSelect.value
    };

    try {
      if (this.editingAlarm) {
        await invoke("update_alarm", { alarm });
      } else {
        await invoke("add_alarm", { alarm });
      }

      await this.loadAlarms();
      this.closeModal();
    } catch (e) {
      console.error("Failed to save alarm:", e);
    }
  }

  private editAlarm(id: string) {
    const alarm = this.alarms.find(a => a.id === id);
    if (alarm) {
      this.openModal(alarm);
    }
  }

  private async toggleAlarm(id: string) {
    const alarm = this.alarms.find(a => a.id === id);
    if (alarm) {
      try {
        await invoke("toggle_alarm", { id, enabled: !alarm.enabled });
        await this.loadAlarms();
      } catch (e) {
        console.error("Failed to toggle alarm:", e);
      }
    }
  }

  private async deleteAlarm(id: string) {
    try {
      await invoke("delete_alarm", { id });
      await this.loadAlarms();
    } catch (e) {
      console.error("Failed to delete alarm:", e);
    }
  }

  private async requestNotificationPermission() {
    try {
      let permissionGranted = await isPermissionGranted();
      if (!permissionGranted) {
        const permission = await requestPermission();
        permissionGranted = permission === "granted";
      }
    } catch (e) {
      console.error("Failed to request notification permission:", e);
    }
  }

  private startAlarmCheck() {
    this.checkAlarms();
  }

  private async checkAlarms() {
    try {
      const triggeredAlarm = await invoke<Alarm | null>("check_alarms");
      if (triggeredAlarm) {
        this.showRingModal(triggeredAlarm);
      }
    } catch (e) {
      console.error("Failed to check alarms:", e);
    }
  }

  private showRingModal(alarm: Alarm) {
    const modal = document.getElementById("ringModal");
    const labelEl = document.getElementById("ringLabel");
    const timeEl = document.getElementById("ringTime");

    if (modal) {
      if (labelEl) labelEl.textContent = alarm.label || "该起床啦！";
      if (timeEl) timeEl.textContent = alarm.time;
      modal.classList.add("show");

      // Play notification
      this.sendNotification(alarm);
    }
  }

  private dismissRing() {
    const modal = document.getElementById("ringModal");
    modal?.classList.remove("show");
  }

  private async sendNotification(alarm: Alarm) {
    try {
      await sendNotification({
        title: "可爱闹钟",
        body: alarm.label || "该起床啦！"
      });
    } catch (e) {
      console.error("Failed to send notification:", e);
    }
  }
}

// Initialize app
new CuteAlarm();
