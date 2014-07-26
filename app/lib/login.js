/**
 * Piwik - Open source web analytics
 *
 * @link http://piwik.org
 * @license http://www.gnu.org/licenses/gpl-3.0.html Gpl v3 or later
 */

var L     = require('L');
var Alloy = require('alloy');

var accessUrl = '';

var win = null;

function showWaitingIndicator()
{
    if (win) {
        return win;
    }

    var style = '';
    if (OS_IOS){
      style = Ti.UI.iPhone.ActivityIndicatorStyle.DARK;
    } else {
      style = Ti.UI.ActivityIndicatorStyle.DARK;
    }

    var activityIndicator = Ti.UI.createActivityIndicator({
      font: {fontSize: OS_ANDROID ? '18dp' : 26, fontWeight:'bold'},
      message: L('Mobile_VerifyAccount'),
      style: style
    });

    win = Ti.UI.createWindow({backgroundColor: '#ddd', opacity: 0.8, zIndex: 99999});
    win.add(activityIndicator);
    win.open();

    activityIndicator.show();
    activityIndicator = null;
}

function hideWaitingIndicator()
{
    if (win) {
        win.close();
        win = null;
    }
}

function onError (accountModel, error) {
    hideWaitingIndicator();

    var message = '';
    var title   = '';

    switch (error) {
        case 'MissingUsername':
            message = String.format(L('General_Required'), L('General_Username'));
            title   = 'Account Missing Username';
            break;
        case 'MissingPassword':
            message = String.format(L('General_Required'), L('General_Password'));
            title   = 'Account Missing Password';
            break;
        case 'InvalidUrl':
            message = String.format(L('SitesManager_ExceptionInvalidUrl'), accessUrl + '');
            title   = 'Account Invalid Url';
            break;
        case 'ReceiveAuthTokenError':
            message = L('Mobile_SaveSuccessError');
            title   = 'Account Receive Token Error';
            break;
        case 'NoViewAccess':
            message = String.format(L('General_ExceptionPrivilegeAtLeastOneWebsite'), L('UsersManager_PrivView'));
            title   = 'Account No View Access';
            break;
        case 'IncompatiblePiwikVersion':
            message = L('Mobile_IncompatiblePiwikVersion');
            title   = 'Piwik Version Incomptaible';
            break;
        default:
            title   = 'Unknown error';
            message = L('An unknown error has occured:\n' + error);
            require('Piwik/Tracker').setCustomVariable(1, 'Login error', '' + error, 'event');
    }

    if (title) {
        require('Piwik/Tracker').trackEvent({name: title, category: 'Login', action: 'result'});
    }

    var alertDialog = Ti.UI.createAlertDialog({
        title: L('General_Error'),
        message: message,
        buttonNames: [L('General_Ok')]
    });

    alertDialog.show();
}

function onNetworkError(undefined, error) {
    hideWaitingIndicator();

    if (error) {

        var dialog = Ti.UI.createAlertDialog({title: error.getError(), message: error.getMessage(), buttonNames: [L('General_Ok')]});
        dialog.show();
        dialog = null;
    }
}

function fetchAuthToken(account)
{
    var username = account.getUsername();
    var password = account.getPassword();

    var tokenAuth = Alloy.createModel('piwikTokenAuth');
    tokenAuth.fetchToken(account, username, password, function (model) {
        if (model && model.getTokenAuth()) {
            account.set({tokenAuth: model.getTokenAuth()});
        }
    }, onNetworkError);
}

exports.login = function(accounts, accessUrl, username, password)
{
    var account = Alloy.createModel('AppAccounts');
    account.on('error', onError);
    
    account.set({
        accessUrl: accessUrl,
        username: username,
        password: password,
        name: accessUrl
    });

    if (!account.isValid()) {
        return;
    }
   
    var actuallySaveAccount = function (accountModel) {
        require('Piwik/Tracker').trackEvent({name: 'Account Login Success', action: 'result', category: 'Login'});
        
        accountModel.save();
        accountModel.off();
        accounts.add(accountModel);
        accountModel = null;        
    };
    
    var saveAccountIfPiwikVersionIsGood = function (piwikVersionModel, accountModel)
    {
        if (piwikVersionModel.isFullyCompatible()) {
            
           actuallySaveAccount(accountModel);
           
        } else if (piwikVersionModel.isRestrictedCompatible()) {
            var version = piwikVersionModel.getVersion();
   
            var alertDialog = Ti.UI.createAlertDialog({
                title: L('Mobile_RestrictedCompatibility'),
                message: String.format(L('Mobile_RestrictedCompatibilityExplanation'), version + ''),
                buttonNames: [L('General_Ok'), L('General_Cancel')],
                cancel: 1,
                selectedIndex: 1
            });
            
            alertDialog.addEventListener('click', function (clickEvent) {
                if (!clickEvent || clickEvent.cancel === clickEvent.index || true === clickEvent.cancel) {
                        
                    accountModel.clear({silent: true});
                    accountModel = null;
        
                    return;
                }

                actuallySaveAccount(accountModel);
            });
            
            alertDialog.show(); 
            
        } else {

            accountModel.clear({silent: true});
            accountModel.trigger('error', accountModel, 'IncompatiblePiwikVersion');
        }
    };

    var makeSureUserHasGoodPiwikVersion = function (accountModel)
    {
        var version = Alloy.createModel('piwikVersion');
        version.fetch({
            account: accountModel,
            success: function(model) {
                
                hideWaitingIndicator();

                saveAccountIfPiwikVersionIsGood(model, accountModel);
                accountModel = null;
                
            },
            error: function(undefined, error) {
                
                accountModel.clear({silent: true});
                accountModel = null;

                onNetworkError(undefined, error);
            }
        });
    };

    var makeSureUserHasAccessToAtLeastOneWebsite = function (accountModel)
    {
        if (!accountModel) {
            console.info('Cannot verify auth token, no account given', 'login');
            return;
        }

        var site = Alloy.createCollection('piwikAccessVerification');

        site.fetch({
            account: accountModel,
            success: function (siteCollection) {

                if (!siteCollection.hasAccessToAtLeastOneWebsite()) {
                    accountModel.trigger('error', accountModel, 'NoViewAccess');

                    return;
                }

                makeSureUserHasGoodPiwikVersion(accountModel);
                accountModel = null;

            }, error: function (undefined, error) {

                accountModel.clear({silent: true});
                accountModel = null;

                onNetworkError(undefined, error);
            }
        });
    };

    account.on('change:tokenAuth', makeSureUserHasAccessToAtLeastOneWebsite);

    showWaitingIndicator();

    fetchAuthToken(account);
};
