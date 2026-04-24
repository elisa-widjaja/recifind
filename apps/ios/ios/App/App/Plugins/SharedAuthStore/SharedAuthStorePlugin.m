#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(SharedAuthStorePlugin, "SharedAuthStore",
  CAP_PLUGIN_METHOD(setJwt, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(getJwt, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(clearJwt, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(readPendingShare, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(clearPendingShare, CAPPluginReturnPromise);
)
