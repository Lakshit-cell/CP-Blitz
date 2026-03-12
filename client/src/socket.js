import { io } from "socket.io-client";

const serverUrl = import.meta.env.VITE_SERVER_URL || undefined; // undefined => same-origin

export const socket = io(serverUrl, { transports: ["websocket"] });

