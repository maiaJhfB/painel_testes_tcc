module.exports = ({ config }) => {
  const serverUrl = process.env.EXPO_PUBLIC_DEV_SERVER_URL || config.extra.DEV_SERVER_URL;
  return {
    ...config,
    extra: { ...config.extra, DEV_SERVER_URL: serverUrl, SIGNALING_SERVER_URL: serverUrl },
  };
};
