Editor.TransloaditClient = SC.Object.extend({
  
  assemblyId: null,
  params: null,
  assembly: null,
  
  service: 'http://api2.transloadit.com/',
  interval: 2500,
  instance: null,
  uploadUrl: function() {
    return this.get('instance') + '/assemblies';
  }.property('instance').cacheable(),
  documentTitle: null,
  uploads: null,
  results: null,
  ended: NO,
  started: false,
  wait: NO,

  didRaiseError: function(instance) { console.log('didRaiseError', instance); },
  didProgress: function(bytesReceived, bytesExpected, assembly) { console.log('didProgress', bytesReceived, bytesExpected, assembly); },
  didCompleteUpload: function(upload, assembly) { console.log('didCompleteUpload', upload, assembly); },
  didReceiveResult: function(step, result, assembly) { console.log('didReceiveResult', step, result, assembly); },
  didCancel: function(assembly) { console.log('didCancel', assembly); },
  didSucceed: function(assembly) { console.log('didSucceed', assembly); },

  _timer: null,
  _pollStarted: null,
  _pollRetries: 0,
  _seq: 0,
  _lastPoll: 0,
  
  init: function(){
    sc_super();
    this.set('uploads', []);
    this.set('results', SC.Object.create({}));
  },
  getBoredInstance: function() {
    var self = this;

    this.instance = null;

    $.jsonp({
      url: this.get('service') + 'instances/bored',
      timeout: 6000,
      callbackParameter: 'callback',
      success: function(instance) {
        if (instance.error) {
          self.set('ended', YES);
          self.didRaiseError(instance);
          return;
        }

        self.set('instance', 'http://' + instance.api2_host);
      },
      error: function(xhr, status) {
        self.set('ended', YES);
        var err =
          { error: 'CONNECTION_ERROR'
          , message: 'There was a problem connecting to the upload server'
          , reason: 'JSONP request status: ' + status
          };
        self.didRaiseError(err);
      }
    });
  },
  
  startPolling: function() {
    var self = this;
    
    if (SC.empty(this.get('assemblyId'))) {
      var err =
        { error: 'CONFIGURATION_ERROR'
        , message: 'You must set the assemblyId before starting to poll.'
        , reason: ''
        };
      this.didRaiseError(err);
    }
    
    setTimeout(function() {
      self._poll();
    }, 300);
  },
  
  _poll: function(query) {
    var self = this;
    if (this.ended) {
      return;
    }

    // Reduce Firefox Title Flickering
    if ($.browser['mozilla'] && !this.documentTitle) {
      this.documentTitle = document.title;
      document.title = 'Loading...';
    }

    this._pollStarted = +new Date();

    $.jsonp({
      url: this.get('instance') + '/assemblies/' + this.get('assemblyId') + (query || '?seq=' + this._seq),
      timeout: 6000,
      callbackParameter: 'callback',
      success: function(assembly) {
        if (self.get('ended')) {
          return;
        }

        self.set('assembly', assembly);
        if (assembly.error == 'ASSEMBLY_NOT_FOUND') {
          self._pollRetries++;
          if (self._pollRetries > 15) {
            document.title = self.documentTitle;
            self.set('ended', YES);
            self.didRaiseError(assembly);
            return;
          }

          setTimeout(function() {
            self._poll();
          }, 400);
          return;
        } else if (assembly.error) {
          self.set('ended', YES);
          document.title = self.documentTitle;
          self.didRaiseError(assembly);
          return;
        }

        self._seq = assembly.last_seq;

        if (!self.get('started')) {
          self.set('started', YES);
        }

        self._pollRetries = 0;
        var isUploading = (assembly.ok == 'ASSEMBLY_UPLOADING')
          , isExecuting = (assembly.ok == 'ASSEMBLY_EXECUTING')
          , isCanceled = (assembly.ok == 'ASSEMBLY_CANCELED')
          , isComplete = (assembly.ok == 'ASSEMBLY_COMPLETED');

        self.didProgress(assembly.bytes_received, assembly.bytes_expected, assembly);

        for (var i = 0; i < assembly.uploads.length; i++) {
          self.didCompleteUpload(assembly.uploads[i], assembly);
          self.get('uploads').pushObject(assembly.uploads[i]);
        }

        for (var step in assembly.results) {
          self.get('results').set(step, self.results[step] || []);
          for (var j = 0; j < assembly.results[step].length; j++) {
            self.didReceiveResult(step, assembly.results[step][j], assembly);
            self.get('results').get(step).pushObject(assembly.results[step][j]);
          }
        }

        if (isCanceled) {
          self.set('ended', YES);
          document.title = self.documentTitle;
          self.didCancel(assembly);
          return;
        }

        if (isComplete || (!self.get('wait') && isExecuting)) {
          self.set('ended', YES);
          document.title = self.documentTitle;
          assembly.uploads = self.get('uploads');
          assembly.results = self.get('results');
          self.didSucceed(assembly);
          return;
        }

        var ping = (self._pollStarted - +new Date)
          , timeout = (ping < self.get('interval'))
            ? self.get('interval')
            : ping;

        self._timer = setTimeout(function() {
          self._poll();
        }, timeout);
        self._lastPoll = +new Date;
      },
      error: function(xhr, status) {
        if (self.get('ended')) {
          return;
        }

        self._pollRetries++;
        if (self._pollRetries > 3) {
          document.title = self.documentTitle;
          self.set('ended', YES);
          var err =
            { error: 'CONNECTION_ERROR'
            , message: 'There was a problem connecting to the upload server'
            , reason: 'JSONP request status: '+status
            };
          self.didRaiseError(err);
          return;
        }

        setTimeout(function() {
          self._poll();
        }, 350);
      }
    });
  },
  stop: function() {
    document.title = this.documentTitle;
    this.set('ended', YES);
  },
  cancel: function() {
    // @todo this has still a race condition if a new upload is started
    // while a the cancel request is still being executed. Shouldn't happen
    // in real life, but needs fixing.

    if (!this.get('ended')) {
      var self = this;
      clearTimeout(self._timer);
      this._poll('?method=delete');
    }
  }
  
});