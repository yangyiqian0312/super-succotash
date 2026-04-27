import request from "request";

const authHost = "https://auth.tiktok-shops.com";
const grantType = "authorized_code";

export type TikTokTokenResponse = {
  code?: number;
  message?: string;
  data?: {
    access_token?: string;
    refresh_token?: string;
    access_token_expire_in?: number;
    refresh_token_expire_in?: number;
    open_id?: string;
    seller_name?: string;
  };
};

function callTokenEndpoint(path: string, qs: Record<string, string>) {
  return new Promise<{
    statusCode?: number;
    body: TikTokTokenResponse;
  }>((resolve, reject) => {
    request(
      {
        method: "GET",
        url: `${authHost}${path}`,
        qs,
        useQuerystring: true,
        json: true,
      },
      (error, response, body: TikTokTokenResponse) => {
        if (error) {
          reject(error);
          return;
        }

        resolve({
          statusCode: response.statusCode,
          body,
        });
      },
    );
  });
}

export async function getTikTokAccessTokenWithAuthCode(input: {
  authCode: string;
  appKey: string;
  appSecret: string;
}) {
  return callTokenEndpoint("/api/v2/token/get", {
    grant_type: grantType,
    auth_code: input.authCode,
    app_key: input.appKey,
    app_secret: input.appSecret,
  });
}

export async function refreshTikTokToken(input: {
  refreshToken: string;
  appKey: string;
  appSecret: string;
}) {
  return callTokenEndpoint("/api/v2/token/refresh", {
    grant_type: grantType,
    refresh_token: input.refreshToken,
    app_key: input.appKey,
    app_secret: input.appSecret,
  });
}
