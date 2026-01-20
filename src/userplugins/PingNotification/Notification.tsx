/*
 * PingNotification - Notification Component
 */

import { findByPropsLazy, findStoreLazy } from "@webpack";
import {
    ChannelStore,
    GuildMemberStore,
    GuildStore,
    RelationshipStore,
    UserStore,
    React,
} from "@webpack/common";
import type { Message, Channel } from "discord-types/general";

import { pluginSettings } from "../index";

const GuildRoleStore = findStoreLazy("GuildRoleStore");

interface NotificationComponentProps {
    message: Message;
    channel: Channel;
    isKeywordMatch: boolean;
    matchedKeyword: string | null;
    onClose: (isManual: boolean) => void;
    onClick: () => void;
}

export function NotificationComponent({
    message,
    channel,
    isKeywordMatch,
    matchedKeyword,
    onClose,
    onClick,
}: NotificationComponentProps) {
    const settings = pluginSettings.store;
    const guild = channel.guild_id ? GuildStore.getGuild(channel.guild_id) : null;
    const member = guild ? GuildMemberStore.getMember(guild.id, message.author.id) : null;
    const user = UserStore.getUser(message.author.id);

    // Get display name
    const getDisplayName = (): string => {
        const customNickname = RelationshipStore.getNickname(message.author.id);
        if (settings.useFriendNicknames && !channel.guild_id && customNickname) {
            return customNickname;
        }
        if (settings.showNicknames && member?.nick) {
            return member.nick;
        }
        if (settings.usernameOrDisplayName) {
            return (message.author as any).globalName || message.author.username;
        }
        return message.author.username;
    };

    // Get role color
    const getRoleColor = (): string | null => {
        if (!guild || !member || !member.roles) return null;
        try {
            const guildRoles = GuildRoleStore?.getRoles?.(guild.id);
            if (!guildRoles) return null;

            const roles = member.roles
                .map((roleId: string) => guildRoles[roleId])
                .filter((role: any) => role && typeof role.color === "number" && role.color !== 0);

            if (roles.length === 0) return null;
            const colorRole = roles.sort((a: any, b: any) => (b.position || 0) - (a.position || 0))[0];
            return colorRole ? `#${colorRole.color.toString(16).padStart(6, "0")}` : null;
        } catch {
            return null;
        }
    };

    // Get avatar URL
    const getAvatarUrl = (): string => {
        if (user?.getAvatarURL) {
            try {
                return user.getAvatarURL(channel.guild_id) || user.getAvatarURL();
            } catch {
                // Fall through to default
            }
        }
        if (message.author.avatar) {
            return `https://cdn.discordapp.com/avatars/${message.author.id}/${message.author.avatar}.png?size=128`;
        }
        return `https://cdn.discordapp.com/embed/avatars/0.png`;
    };

    // Get notification title
    const getNotificationTitle = (): string => {
        if (channel.guild_id) {
            const guildName = guild?.name || "Unknown Server";
            return `${guildName} • #${channel.name || "unknown"}`;
        } else if (channel.type === 3) {
            // Group DM
            return `Group Chat`;
        }
        return "Direct Message";
    };

    const displayName = getDisplayName();
    const roleColor = getRoleColor();
    const avatarUrl = getAvatarUrl();
    const notificationTitle = getNotificationTitle();

    const isNSFW = (channel as any).nsfw || (channel as any).nsfw_;
    const shouldBlur = settings.privacyMode || (settings.applyNSFWBlur && isNSFW);

    return (
        <div
            className={`vc-ping-notification-content ${shouldBlur ? "privacy-mode" : ""}`}
            onClick={(e) => {
                const target = e.target as HTMLElement;
                const isLink = target.tagName === "A" || target.closest("a");
                if (isLink && !settings.disableMediaInteraction) {
                    e.stopPropagation();
                    return;
                }
                onClick();
            }}
            onContextMenu={(e) => {
                if (settings.closeOnRightClick) {
                    e.preventDefault();
                    e.stopPropagation();
                    onClose(true);
                }
            }}
            style={{
                width: `${settings.maxWidth}px`,
                maxHeight: `${settings.maxHeight}px`,
            }}
        >
            <div className="vc-ping-notification-header">
                <img
                    src={avatarUrl}
                    alt="Avatar"
                    className="vc-ping-notification-avatar"
                />
                <div className="vc-ping-notification-title-container">
                    <span
                        className="vc-ping-notification-username"
                        style={{
                            color: settings.coloredUsernames && roleColor ? roleColor : undefined,
                        }}
                    >
                        {displayName}
                    </span>
                    <span className="vc-ping-notification-subtitle">
                        {notificationTitle}
                        {isNSFW && settings.applyNSFWBlur && (
                            <span className="vc-ping-notification-nsfw"> • NSFW</span>
                        )}
                    </span>
                </div>
                <button
                    className="vc-ping-notification-close"
                    onClick={(e) => {
                        e.stopPropagation();
                        onClose(true);
                    }}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
                    </svg>
                </button>
            </div>

            <div className="vc-ping-notification-body">
                <div className="vc-ping-notification-message">
                    {message.content || <em>No text content</em>}
                </div>

                {message.attachments && message.attachments.length > 0 && (
                    <div className="vc-ping-notification-attachments">
                        {message.attachments.slice(0, 2).map((attachment: any) => (
                            <div key={attachment.id} className="vc-ping-notification-attachment">
                                {attachment.content_type?.startsWith("image/") ? (
                                    <img
                                        src={attachment.proxy_url || attachment.url}
                                        alt="Attachment"
                                        className="vc-ping-notification-image"
                                    />
                                ) : (
                                    <div className="vc-ping-notification-file">
                                        📎 {attachment.filename}
                                    </div>
                                )}
                            </div>
                        ))}
                        {message.attachments.length > 2 && (
                            <span className="vc-ping-notification-more">
                                +{message.attachments.length - 2} more
                            </span>
                        )}
                    </div>
                )}

                {message.embeds && message.embeds.length > 0 && (
                    <div className="vc-ping-notification-embeds">
                        {message.embeds.slice(0, 1).map((embed: any, i: number) => (
                            <div key={i} className="vc-ping-notification-embed">
                                {embed.title && (
                                    <div className="vc-ping-notification-embed-title">
                                        {embed.title}
                                    </div>
                                )}
                                {embed.description && (
                                    <div className="vc-ping-notification-embed-desc">
                                        {embed.description.slice(0, 100)}
                                        {embed.description.length > 100 ? "..." : ""}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {shouldBlur && (
                <div className="vc-ping-notification-blur-hint">Hover to reveal</div>
            )}

            {isKeywordMatch && matchedKeyword && settings.showKeyword && (
                <div className="vc-ping-notification-keyword">
                    Keyword: {matchedKeyword}
                </div>
            )}

            {settings.showTimer && (
                <div className="vc-ping-notification-timer">
                    <div className="vc-ping-notification-progress" />
                </div>
            )}
        </div>
    );
}
