/*
 * Vencord/Equicord UserPlugin: PingNotification
 * Ported from BetterDiscord plugin by DaddyBoard
 * https://github.com/DaddyBoard/BD-Plugins
 *
 * Shows in-app notifications for anything you would hear a ping for.
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import {
    ChannelStore,
    FluxDispatcher,
    GuildMemberStore,
    GuildStore,
    RelationshipStore,
    SelectedChannelStore,
    UserStore,
    React,
    ReactDOM,
} from "@webpack/common";
import type { Message, Channel } from "discord-types/general";

import { NotificationComponent } from "./components/Notification";
import { openNotificationHistoryModal } from "./components/HistoryModal";

// Stores
const UserGuildSettingsStore = findStoreLazy("UserGuildSettingsStore");
const PresenceStore = findStoreLazy("PresenceStore");
const IdleStore = findStoreLazy("IdleStore");
const WindowStore = findStoreLazy("WindowStore");
const MessageStore = findStoreLazy("MessageStore");

// Modules
const NotificationModule = findByPropsLazy("shouldNotify");
const transitionTo = findByPropsLazy("transitionToGuild");

interface NotificationData {
    id: string;
    message: Message;
    channel: Channel;
    creationTime: number;
    isKeywordMatch: boolean;
    matchedKeyword: string | null;
    element?: HTMLElement;
    timeoutId?: NodeJS.Timeout;
}

const activeNotifications: NotificationData[] = [];
const sessionMessages: { id: string; channel_id: string; }[] = [];

export const settings = definePluginSettings({
    // Behavior Settings
    duration: {
        type: OptionType.SLIDER,
        description: "How long notifications stay on screen (in seconds)",
        default: 15,
        markers: [1, 10, 20, 30, 40, 50, 60],
        stickToMarkers: false,
    },
    popupLocation: {
        type: OptionType.SELECT,
        description: "Where notifications appear on screen",
        default: "bottomRight",
        options: [
            { label: "Top Left", value: "topLeft" },
            { label: "Top Centre", value: "topCentre" },
            { label: "Top Right", value: "topRight" },
            { label: "Bottom Left", value: "bottomLeft" },
            { label: "Bottom Right", value: "bottomRight", default: true },
        ],
    },
    readChannelOnClose: {
        type: OptionType.BOOLEAN,
        description: "Automatically mark the channel as read when closing a notification",
        default: false,
    },
    disableMediaInteraction: {
        type: OptionType.BOOLEAN,
        description: "Make all clicks navigate to the message instead of allowing media interaction",
        default: false,
    },
    overrideDND: {
        type: OptionType.SELECT,
        description: "Show notifications even when your status is set to Do Not Disturb",
        default: "off",
        options: [
            { label: "Off", value: "off", default: true },
            { label: "On", value: "on" },
            { label: "On + Sound", value: "onWithSound" },
        ],
    },
    closeOnRead: {
        type: OptionType.BOOLEAN,
        description: "Close notifications when you navigate to the message's origin channel",
        default: true,
    },
    closeOnRightClick: {
        type: OptionType.BOOLEAN,
        description: "Close notifications when right-clicking on them",
        default: false,
    },

    // Appearance Settings
    privacyMode: {
        type: OptionType.BOOLEAN,
        description: "Blur notification content until hovered",
        default: false,
    },
    applyNSFWBlur: {
        type: OptionType.BOOLEAN,
        description: "Blur content from NSFW channels only",
        default: false,
    },
    showTimer: {
        type: OptionType.BOOLEAN,
        description: "Show countdown timer on notifications",
        default: true,
    },
    hideOrangeBorderOnMentions: {
        type: OptionType.BOOLEAN,
        description: "Hide the orange background on messages that mention you",
        default: true,
    },

    // User Styling
    coloredUsernames: {
        type: OptionType.BOOLEAN,
        description: "Show usernames in their role colors",
        default: true,
    },
    showNicknames: {
        type: OptionType.BOOLEAN,
        description: "Use server nicknames instead of usernames",
        default: true,
    },
    usernameOrDisplayName: {
        type: OptionType.BOOLEAN,
        description: "Use display name instead of username when no nickname is set",
        default: false,
    },
    useFriendNicknames: {
        type: OptionType.BOOLEAN,
        description: "Show your custom friend nicknames in DMs",
        default: true,
    },

    // Keyword Notifications
    enableKeywordNotifications: {
        type: OptionType.BOOLEAN,
        description: "Show notifications when messages contain your keywords",
        default: false,
    },
    keywordOnlyMode: {
        type: OptionType.BOOLEAN,
        description: "Only show notifications if the content matches any of your keyword rules",
        default: false,
    },
    simulateAudioNotification: {
        type: OptionType.BOOLEAN,
        description: "Play notification sound when a keyword notification is shown",
        default: true,
    },
    exactMatch: {
        type: OptionType.BOOLEAN,
        description: "Only trigger on exact keyword matches (not partial)",
        default: true,
    },
    showKeyword: {
        type: OptionType.BOOLEAN,
        description: "Show the matched keyword in the notification",
        default: true,
    },
    notificationKeywords: {
        type: OptionType.STRING,
        description: "Keywords that trigger notifications, separated by commas",
        default: "",
    },
    regexPatterns: {
        type: OptionType.STRING,
        description: "REGEX patterns that trigger notifications, separated by ;;;",
        default: "",
    },

    // Reaction Notifications
    enableReactionNotifications: {
        type: OptionType.BOOLEAN,
        description: "Show notifications when people react to your messages",
        default: true,
    },

    // Advanced
    maxWidth: {
        type: OptionType.SLIDER,
        description: "Notification width (px)",
        default: 370,
        markers: [200, 250, 300, 350, 370, 400],
        stickToMarkers: false,
    },
    maxHeight: {
        type: OptionType.SLIDER,
        description: "Notification height (px)",
        default: 300,
        markers: [200, 250, 300, 400, 500, 600],
        stickToMarkers: false,
    },
});

function shouldNotify(message: Message, channel: Channel): { notify: boolean; isKeywordMatch: boolean; matchedKeyword: string | null; } {
    const currentUser = UserStore.getCurrentUser();
    if (!currentUser || message.author.id === currentUser.id) {
        return { notify: false, isKeywordMatch: false, matchedKeyword: null };
    }

    // Check DND status
    const presence = PresenceStore.getStatus(currentUser.id);
    if (presence === "dnd" && settings.store.overrideDND === "off") {
        return { notify: false, isKeywordMatch: false, matchedKeyword: null };
    }

    // Check if in current channel
    if (channel.id === SelectedChannelStore.getChannelId()) {
        return { notify: false, isKeywordMatch: false, matchedKeyword: null };
    }

    let keywordMatch: string | null = null;

    // Check keyword notifications
    if (settings.store.enableKeywordNotifications && settings.store.notificationKeywords) {
        const keywords = settings.store.notificationKeywords
            .split(",")
            .map((k: string) => k.trim())
            .filter((k: string) => k.length > 0);

        const content = message.content || "";

        for (const keyword of keywords) {
            if (settings.store.exactMatch) {
                const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                const startsWithWord = /^\w/.test(keyword);
                const endsWithWord = /\w$/.test(keyword);
                const pattern = `${startsWithWord ? "\\b" : ""}${escapedKeyword}${endsWithWord ? "\\b" : ""}`;
                const wordRegex = new RegExp(pattern, "i");
                if (wordRegex.test(content)) {
                    keywordMatch = keyword;
                    break;
                }
            } else {
                if (content.toLowerCase().includes(keyword.toLowerCase())) {
                    keywordMatch = keyword;
                    break;
                }
            }
        }

        // Check regex patterns
        if (!keywordMatch && settings.store.regexPatterns) {
            const patterns = settings.store.regexPatterns
                .split(";;;")
                .map((p: string) => p.trim())
                .filter((p: string) => p.length > 0);

            for (let i = 0; i < patterns.length; i++) {
                try {
                    const regex = new RegExp(patterns[i], "i");
                    if (regex.test(content)) {
                        keywordMatch = `REGEX Index: ${i + 1}`;
                        break;
                    }
                } catch (e) {
                    console.error(`PingNotification: Invalid regex pattern "${patterns[i]}":`, e);
                }
            }
        }
    }

    // Keyword only mode
    if (settings.store.keywordOnlyMode) {
        return {
            notify: !!keywordMatch,
            isKeywordMatch: !!keywordMatch,
            matchedKeyword: keywordMatch,
        };
    }

    // Use Discord's native notification check
    let shouldNotifyDiscord = false;
    try {
        if (NotificationModule?.shouldNotify) {
            shouldNotifyDiscord = NotificationModule.shouldNotify(
                message,
                message.channel_id,
                false,
                settings.store.overrideDND !== "off"
            );
        }
    } catch (e) {
        console.error("PingNotification: Error checking shouldNotify:", e);
    }

    if (shouldNotifyDiscord || keywordMatch) {
        return {
            notify: true,
            isKeywordMatch: !!keywordMatch,
            matchedKeyword: keywordMatch,
        };
    }

    return { notify: false, isKeywordMatch: false, matchedKeyword: null };
}

function createNotificationElement(data: NotificationData): HTMLElement {
    const container = document.createElement("div");
    container.className = "vc-ping-notification";
    container.dataset.channelId = data.channel.id;
    container.dataset.messageId = data.message.id;

    const { popupLocation } = settings.store;
    if (popupLocation.endsWith("Centre")) {
        container.classList.add("centre");
    }

    // Create React root and render
    const root = ReactDOM.createRoot?.(container) ?? (ReactDOM as any).createRoot(container);
    if (root) {
        root.render(
            React.createElement(NotificationComponent, {
                message: data.message,
                channel: data.channel,
                isKeywordMatch: data.isKeywordMatch,
                matchedKeyword: data.matchedKeyword,
                onClose: (isManual: boolean) => removeNotification(data.id, isManual),
                onClick: () => {
                    navigateToMessage(data.channel, data.message);
                    removeNotification(data.id, true);
                },
            })
        );
        (container as any)._reactRoot = root;
    }

    return container;
}

function showNotification(message: Message, channel: Channel, notifyResult: { isKeywordMatch: boolean; matchedKeyword: string | null; }): void {
    const notificationId = `${message.id}-${Date.now()}`;

    const data: NotificationData = {
        id: notificationId,
        message,
        channel,
        creationTime: Date.now(),
        isKeywordMatch: notifyResult.isKeywordMatch,
        matchedKeyword: notifyResult.matchedKeyword,
    };

    const element = createNotificationElement(data);
    data.element = element;

    // Add to DOM
    const appMount = document.getElementById("app-mount");
    if (appMount) {
        appMount.appendChild(element);
        requestAnimationFrame(() => {
            element.classList.add("show");
        });
    }

    // Set timeout for auto-close
    const duration = settings.store.duration * 1000;
    data.timeoutId = setTimeout(() => {
        removeNotification(notificationId, false);
    }, duration);

    activeNotifications.push(data);
    adjustNotificationPositions();

    // Track in session history
    if (!message.id.includes("test-")) {
        sessionMessages.push({ id: message.id, channel_id: channel.id });
    }
}

function removeNotification(id: string, isManual: boolean): void {
    const index = activeNotifications.findIndex(n => n.id === id);
    if (index === -1) return;

    const notification = activeNotifications[index];

    if (notification.timeoutId) {
        clearTimeout(notification.timeoutId);
    }

    if (notification.element) {
        notification.element.classList.remove("show");
        notification.element.classList.add("hide");

        // Cleanup React
        const root = (notification.element as any)._reactRoot;
        if (root) {
            setTimeout(() => root.unmount(), 300);
        }

        setTimeout(() => {
            notification.element?.remove();
        }, 300);
    }

    activeNotifications.splice(index, 1);
    adjustNotificationPositions();
}

function removeAllNotifications(): void {
    [...activeNotifications].forEach(n => removeNotification(n.id, false));
}

function adjustNotificationPositions(): void {
    const { popupLocation } = settings.store;
    let offset = 30;
    const isTop = popupLocation.startsWith("top");
    const isLeft = popupLocation.endsWith("Left");
    const isCentre = popupLocation.endsWith("Centre");

    const sorted = [...activeNotifications].sort((a, b) => b.creationTime - a.creationTime);

    sorted.forEach(notification => {
        if (!notification.element) return;

        const height = notification.element.offsetHeight;
        notification.element.style.position = "fixed";

        if (isTop) {
            notification.element.style.top = `${offset}px`;
            notification.element.style.bottom = "auto";
        } else {
            notification.element.style.bottom = `${offset}px`;
            notification.element.style.top = "auto";
        }

        if (isCentre) {
            notification.element.style.left = "50%";
            notification.element.style.right = "auto";
            notification.element.style.transform = "translateX(-50%)";
        } else if (isLeft) {
            notification.element.style.left = "20px";
            notification.element.style.right = "auto";
            notification.element.style.transform = "none";
        } else {
            notification.element.style.right = "20px";
            notification.element.style.left = "auto";
            notification.element.style.transform = "none";
        }

        offset += height + 10;
    });
}

function navigateToMessage(channel: Channel, message: Message): void {
    // Close all notifications from the same channel
    const toRemove = activeNotifications.filter(n => n.channel.id === channel.id);
    toRemove.forEach(n => removeNotification(n.id, true));

    // Navigate
    if (transitionTo?.transitionToGuild) {
        transitionTo.transitionToGuild(channel.guild_id, channel.id, message.id);
    }
}

function onMessageCreate({ message, optimistic }: { message: Message; optimistic?: boolean; }): void {
    if (optimistic) return;
    if (!message?.channel_id) return;

    const channel = ChannelStore.getChannel(message.channel_id);
    if (!channel) return;

    const notifyResult = shouldNotify(message, channel);
    if (notifyResult.notify) {
        showNotification(message, channel, notifyResult);
    }
}

function onMessageAck({ channelId }: { channelId: string; }): void {
    if (!settings.store.closeOnRead) return;

    const toRemove = activeNotifications.filter(n => n.channel.id === channelId);
    toRemove.forEach(n => removeNotification(n.id, false));
}

function onReactionAdd(event: { userId: string; channelId: string; messageId: string; messageAuthorId: string; emoji: { name: string; id?: string; }; }): void {
    if (!settings.store.enableReactionNotifications) return;
    if (settings.store.keywordOnlyMode) return;

    const currentUser = UserStore.getCurrentUser();
    if (!currentUser) return;
    if (event.messageAuthorId !== currentUser.id) return;
    if (event.userId === currentUser.id) return;

    const channel = ChannelStore.getChannel(event.channelId);
    if (!channel) return;
    if (channel.id === SelectedChannelStore.getChannelId()) return;

    const reacter = UserStore.getUser(event.userId);
    if (!reacter) return;

    const emojiContent = event.emoji.id
        ? `<a:${event.emoji.name}:${event.emoji.id}>`
        : event.emoji.name;

    const fakeMessage: Message = {
        id: `reaction-${Date.now()}`,
        channel_id: channel.id,
        content: `reacted ${emojiContent} to your message`,
        author: reacter,
        timestamp: new Date().toISOString(),
    } as Message;

    showNotification(fakeMessage, channel, { isKeywordMatch: false, matchedKeyword: null });
}

// CSS Styles
const STYLES_ID = "vc-ping-notification-styles";

const CSS = `
/* PingNotification Styles */

.vc-ping-notification {
    position: fixed;
    z-index: 9999;
    color: var(--text-normal);
    border-radius: 12px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2), 0 2px 4px rgba(0, 0, 0, 0.1);
    overflow: hidden;
    backdrop-filter: blur(10px);
    opacity: 0;
    transform: scale(0.9);
    transition: opacity 0.3s ease, transform 0.3s ease;
    -webkit-app-region: no-drag;
}

.vc-ping-notification.show {
    opacity: 1;
    transform: scale(1);
}

.vc-ping-notification.hide {
    opacity: 0;
    transform: scale(0.9);
}

.vc-ping-notification.centre {
    transform: translateX(-50%) scale(0.9);
}

.vc-ping-notification.centre.show {
    transform: translateX(-50%) scale(1);
}

.vc-ping-notification-content {
    position: relative;
    padding: 16px;
    padding-bottom: 24px;
    min-height: 80px;
    display: flex;
    flex-direction: column;
    background-color: var(--background-secondary);
    border-radius: 12px;
    cursor: pointer;
    user-select: none;
}

.vc-ping-notification-content.privacy-mode .vc-ping-notification-body,
.vc-ping-notification-content.privacy-mode .vc-ping-notification-attachments {
    filter: blur(20px);
    transition: filter 0.3s ease;
}

.vc-ping-notification-content.privacy-mode:hover .vc-ping-notification-body,
.vc-ping-notification-content.privacy-mode:hover .vc-ping-notification-attachments {
    filter: blur(0);
}

.vc-ping-notification-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
}

.vc-ping-notification-avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    border: 2px solid var(--brand-experiment);
    flex-shrink: 0;
}

.vc-ping-notification-title-container {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    overflow: hidden;
}

.vc-ping-notification-username {
    font-size: 16px;
    font-weight: 600;
    color: var(--header-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.vc-ping-notification-subtitle {
    font-size: 12px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.vc-ping-notification-nsfw {
    color: var(--status-danger);
    font-weight: 600;
}

.vc-ping-notification-close {
    position: absolute;
    top: 12px;
    right: 12px;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--background-modifier-hover);
    color: var(--interactive-normal);
    border: none;
    cursor: pointer;
    transition: all 0.2s ease;
    padding: 0;
}

.vc-ping-notification-close:hover {
    background: var(--background-modifier-active);
    color: var(--interactive-hover);
}

.vc-ping-notification-body {
    flex: 1;
    overflow-y: hidden;
    transition: overflow-y 0.2s ease;
    margin-bottom: 8px;
}

.vc-ping-notification-body:hover {
    overflow-y: auto;
}

.vc-ping-notification-message {
    font-size: 14px;
    color: var(--text-normal);
    word-wrap: break-word;
    white-space: pre-wrap;
    line-height: 1.4;
}

.vc-ping-notification-attachments {
    margin-top: 8px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.vc-ping-notification-attachment {
    max-width: 100%;
}

.vc-ping-notification-image {
    max-width: 100%;
    max-height: 150px;
    border-radius: 8px;
    object-fit: contain;
}

.vc-ping-notification-file {
    padding: 8px 12px;
    background: var(--background-tertiary);
    border-radius: 8px;
    font-size: 12px;
    color: var(--text-muted);
}

.vc-ping-notification-more {
    font-size: 12px;
    color: var(--text-muted);
    align-self: center;
}

.vc-ping-notification-embeds {
    margin-top: 8px;
}

.vc-ping-notification-embed {
    padding: 8px 12px;
    background: var(--background-tertiary);
    border-radius: 8px;
    border-left: 4px solid var(--brand-experiment);
}

.vc-ping-notification-embed-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-link);
    margin-bottom: 4px;
}

.vc-ping-notification-embed-desc {
    font-size: 13px;
    color: var(--text-normal);
}

.vc-ping-notification-blur-hint {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    padding: 4px 12px;
    background: var(--background-secondary-alt);
    border-radius: 4px;
    font-size: 12px;
    color: var(--text-muted);
    pointer-events: none;
    z-index: 10;
    transition: opacity 0.3s ease;
}

.vc-ping-notification-content.privacy-mode:hover .vc-ping-notification-blur-hint {
    opacity: 0;
}

.vc-ping-notification-keyword {
    position: absolute;
    bottom: 8px;
    left: 12px;
    padding: 2px 8px;
    background: var(--background-secondary-alt);
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    color: var(--status-danger);
}

.vc-ping-notification-timer {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 4px;
    background: var(--background-tertiary);
    overflow: hidden;
}

.vc-ping-notification-progress {
    height: 100%;
    background: linear-gradient(90deg, var(--status-positive) 0%, var(--status-positive) 100%);
    transition: width 0.1s linear;
}

/* History Modal Styles */

.vc-ping-history-empty {
    padding: 40px 20px;
    text-align: center;
    color: var(--text-muted);
    font-size: 14px;
}

.vc-ping-history-content {
    padding: 16px;
    max-height: 60vh;
    overflow-y: auto;
}

.vc-ping-history-group {
    margin-bottom: 16px;
}

.vc-ping-history-group-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--background-modifier-accent);
}

.vc-ping-history-group-icon {
    width: 24px;
    height: 24px;
    border-radius: 50%;
}

.vc-ping-history-group-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--header-secondary);
}

.vc-ping-history-messages {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.vc-ping-history-message {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px;
    background: var(--background-secondary);
    border-radius: 8px;
}

.vc-ping-history-message.deleted {
    color: var(--text-muted);
    font-style: italic;
    padding: 8px 12px;
}

.vc-ping-history-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    flex-shrink: 0;
}

.vc-ping-history-message-content {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
}

.vc-ping-history-author {
    font-size: 14px;
    font-weight: 600;
    color: var(--header-primary);
}

.vc-ping-history-text {
    font-size: 14px;
    color: var(--text-normal);
    word-wrap: break-word;
    white-space: pre-wrap;
}
`;

function injectStyles(): void {
    if (document.getElementById(STYLES_ID)) return;
    const style = document.createElement("style");
    style.id = STYLES_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
}

function removeStyles(): void {
    document.getElementById(STYLES_ID)?.remove();
}

export default definePlugin({
    name: "PingNotification",
    description: "Show in-app notifications for anything you would hear a ping for",
    authors: [
        { name: "DaddyBoard", id: 241334335884492810n },
        { name: "Ported by Waltee", id: 209065310215602177n },
    ],
    settings,

    toolboxActions: {
        "Notification History": () => {
            openNotificationHistoryModal(sessionMessages);
        },
    },

    start() {
        // Inject CSS
        injectStyles();

        FluxDispatcher.subscribe("MESSAGE_CREATE", onMessageCreate);
        FluxDispatcher.subscribe("MESSAGE_ACK", onMessageAck);
        FluxDispatcher.subscribe("MESSAGE_REACTION_ADD", onReactionAdd);
    },

    stop() {
        FluxDispatcher.unsubscribe("MESSAGE_CREATE", onMessageCreate);
        FluxDispatcher.unsubscribe("MESSAGE_ACK", onMessageAck);
        FluxDispatcher.unsubscribe("MESSAGE_REACTION_ADD", onReactionAdd);
        removeAllNotifications();

        // Remove CSS
        removeStyles();
    },
});

export { activeNotifications, sessionMessages, settings as pluginSettings };
