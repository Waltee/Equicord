/*
 * PingNotification - History Modal Component
 */

import { openModal, ModalRoot, ModalHeader, ModalContent, ModalCloseButton } from "@utils/modal";
import { findStoreLazy } from "@webpack";
import { ChannelStore, GuildStore, UserStore, React } from "@webpack/common";

const MessageStore = findStoreLazy("MessageStore");

interface SessionMessage {
    id: string;
    channel_id: string;
}

interface GroupedMessages {
    channel_id: string;
    messages: SessionMessage[];
}

function HistoryModalContent({ sessionMessages }: { sessionMessages: SessionMessage[]; }) {
    const reversedMessages = [...sessionMessages].reverse();

    // Group by channel
    const groupedMessages: GroupedMessages[] = [];
    let currentGroup: GroupedMessages | null = null;

    reversedMessages.forEach((item) => {
        if (!currentGroup || currentGroup.channel_id !== item.channel_id) {
            currentGroup = {
                channel_id: item.channel_id,
                messages: [item],
            };
            groupedMessages.push(currentGroup);
        } else {
            currentGroup.messages.push(item);
        }
    });

    if (sessionMessages.length === 0) {
        return (
            <div className="vc-ping-history-empty">
                No notification history yet
            </div>
        );
    }

    return (
        <div className="vc-ping-history-content">
            {groupedMessages.map((group, groupIndex) => {
                const channel = ChannelStore.getChannel(group.channel_id);
                if (!channel) return null;

                const guild = channel.guild_id ? GuildStore.getGuild(channel.guild_id) : null;
                const channelName = channel.name || "Direct Message";

                let iconUrl: string;
                if (guild?.icon) {
                    iconUrl = `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=32`;
                } else if (!guild) {
                    const recipients = (channel as any).recipients;
                    if (recipients?.length > 0) {
                        const user = UserStore.getUser(recipients[0]);
                        iconUrl = user?.avatar
                            ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=32`
                            : "https://cdn.discordapp.com/embed/avatars/0.png";
                    } else {
                        iconUrl = "https://cdn.discordapp.com/embed/avatars/0.png";
                    }
                } else {
                    iconUrl = "https://cdn.discordapp.com/embed/avatars/0.png";
                }

                return (
                    <div key={`group-${group.channel_id}-${groupIndex}`} className="vc-ping-history-group">
                        <div className="vc-ping-history-group-header">
                            <img
                                src={iconUrl}
                                alt=""
                                className="vc-ping-history-group-icon"
                            />
                            <span className="vc-ping-history-group-name">
                                {guild ? `${guild.name} • ` : ""}#{channelName}
                            </span>
                        </div>
                        <div className="vc-ping-history-messages">
                            {group.messages.map((item, msgIndex) => {
                                const message = MessageStore?.getMessage?.(item.channel_id, item.id);
                                if (!message) {
                                    return (
                                        <div
                                            key={`${item.id}-${msgIndex}`}
                                            className="vc-ping-history-message deleted"
                                        >
                                            Message no longer available
                                        </div>
                                    );
                                }

                                const author = message.author;
                                const avatarUrl = author.avatar
                                    ? `https://cdn.discordapp.com/avatars/${author.id}/${author.avatar}.png?size=32`
                                    : "https://cdn.discordapp.com/embed/avatars/0.png";

                                return (
                                    <div
                                        key={`${item.id}-${msgIndex}`}
                                        className="vc-ping-history-message"
                                    >
                                        <img
                                            src={avatarUrl}
                                            alt=""
                                            className="vc-ping-history-avatar"
                                        />
                                        <div className="vc-ping-history-message-content">
                                            <span className="vc-ping-history-author">
                                                {author.username}
                                            </span>
                                            <span className="vc-ping-history-text">
                                                {message.content || <em>No text content</em>}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

export function openNotificationHistoryModal(sessionMessages: SessionMessage[]) {
    openModal(props => (
        <ModalRoot {...props} size="medium">
            <ModalHeader>
                <span style={{ fontSize: "18px", fontWeight: 600 }}>
                    PingNotification History
                </span>
                <ModalCloseButton onClick={props.onClose} />
            </ModalHeader>
            <ModalContent>
                <HistoryModalContent sessionMessages={sessionMessages} />
            </ModalContent>
        </ModalRoot>
    ));
}
