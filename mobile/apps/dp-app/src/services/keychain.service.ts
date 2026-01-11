import * as Keychain from 'react-native-keychain';

export const storePrivateKey = async (dpId: string, privateKeyHex: string) => {
  await Keychain.setGenericPassword(dpId, privateKeyHex, {
    service: 'com.example.pod.dp',
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
};

export const retrievePrivateKey = async (dpId: string) => {
  const creds = await Keychain.getGenericPassword({ service: 'com.example.pod.dp' });
  return creds?.password || null;
};