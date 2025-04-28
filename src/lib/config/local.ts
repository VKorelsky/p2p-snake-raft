export const rtcConfig = {
    iceServers: [
        {
            urls: 'stun:stun.relay.metered.ca:80'
        },
        {
            urls: 'turn:global.relay.metered.ca:80',
            username: 'acb86e68047bd92f124b44a6',
            credential: 'mGSHP5Xs9RfJ01aQ'
        },
        {
            urls: 'turn:global.relay.metered.ca:80?transport=tcp',
            username: 'acb86e68047bd92f124b44a6',
            credential: 'mGSHP5Xs9RfJ01aQ'
        },
        {
            urls: 'turn:global.relay.metered.ca:443',
            username: 'acb86e68047bd92f124b44a6',
            credential: 'mGSHP5Xs9RfJ01aQ'
        },
        {
            urls: 'turns:global.relay.metered.ca:443?transport=tcp',
            username: 'acb86e68047bd92f124b44a6',
            credential: 'mGSHP5Xs9RfJ01aQ'
        }
    ]
};
